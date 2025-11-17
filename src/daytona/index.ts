import { Daytona, Image, Sandbox } from "@daytonaio/sdk";
import { env } from "bun";
import path from "node:path";
import { Effect, Fiber, pipe } from "effect";
import { ASK_AGENT_PROMPT, config, DOCS_AGENT_PROMPT } from "./config";
import type { ExecuteResponse } from "@daytonaio/sdk/src/types/ExecuteResponse";

const SANDBOX_VOLUME_ROOT = "/context";

const contextService = Effect.gen(function* () {
  type ContextRepo = {
    name: string;
    url: string;
    branch?: string;
  };

  const contextRepos: ContextRepo[] = [
    {
      name: "effect",
      url: "https://github.com/Effect-TS/effect",
      branch: "main",
    },
    {
      name: "svelte",
      url: "https://github.com/sveltejs/svelte.dev",
      branch: "main",
    },
    {
      name: "daytona",
      url: "https://github.com/daytonaio/daytona",
      branch: "main",
    },
  ];

  const bashrcAddon = `
    echo "STARTING..."
    sleep 2
    opencode attach http://localhost:8080
  `;

  const syncRepo = (args: {
    repo: ContextRepo;
    reposDir: string;
    sandbox: Sandbox;
  }) =>
    Effect.gen(function* () {
      const { repo, reposDir, sandbox } = args;

      const exists = yield* Effect.tryPromise(() =>
        sandbox.fs.listFiles(reposDir)
      ).pipe(
        Effect.map((files) =>
          files.some((f) => f.isDir && f.name === repo.name)
        )
      );

      const repoPath = yield* Effect.sync(() => path.join(reposDir, repo.name));

      let response: ExecuteResponse;

      if (exists) {
        response = yield* Effect.tryPromise({
          try: () => sandbox.process.executeCommand(`git pull`, repoPath),
          catch: (err) => console.error("failed to pull repo", repo.name, err),
        });
      } else {
        response = yield* Effect.tryPromise({
          try: () =>
            sandbox.process.executeCommand(
              `git clone --depth 1 --single-branch --branch ${repo.branch || "main"} ${repo.url} ${repoPath}`
            ),
          catch: (err) => console.error("failed to clone repo", repo.name, err),
        });
      }

      yield* Effect.log(`Synced repo ${repo.name}`, response.result);
    });

  return {
    prepareSshAccess: (args: { sandbox: Sandbox }) =>
      Effect.gen(function* () {
        const { sandbox } = args;

        yield* Effect.log("Preparing ssh access...");

        // yield* Effect.tryPromise(() =>
        //   sandbox.fs.setFilePermissions("/root/.bashrc", {
        //     mode: "755",
        //   })
        // ).pipe(
        //   Effect.catchAll(() => Effect.die("failed to set .bashrc permissions"))
        // );

        const bashrcResult = yield* Effect.tryPromise(() =>
          sandbox.fs.downloadFile("/root/.bashrc")
        ).pipe(Effect.catchAll(() => Effect.die("failed to download .bashrc")));

        const newBashrc = bashrcResult.toString() + bashrcAddon;

        yield* Effect.tryPromise(() =>
          sandbox.fs.uploadFile(Buffer.from(newBashrc), "/root/.bashrc")
        ).pipe(
          Effect.catchAll(() => Effect.die("failed to upload new .bashrc"))
        );

        yield* Effect.log("Ssh access prepared");
      }),
    syncContextRepos: (args: { sandbox: Sandbox }) =>
      Effect.gen(function* () {
        const { sandbox } = args;

        yield* Effect.log("Syncing context repos...");

        const reposDir = yield* Effect.sync(() =>
          path.join(SANDBOX_VOLUME_ROOT, "repos")
        );

        yield* Effect.tryPromise(() =>
          sandbox.fs.createFolder(reposDir, "755")
        );

        yield* Effect.all(
          contextRepos.map((repo) => syncRepo({ repo, reposDir, sandbox })),
          {
            concurrency: 5,
            mode: "default",
          }
        ).pipe(Effect.catchAll(() => Effect.void));
      }),
    syncConfig: (args: { sandbox: Sandbox }) =>
      Effect.gen(function* () {
        const { sandbox } = args;

        yield* Effect.log("Syncing config...");

        yield* Effect.tryPromise(() =>
          sandbox.fs.createFolder(
            path.join(SANDBOX_VOLUME_ROOT, "prompts"),
            "755"
          )
        ).pipe(
          Effect.catchAll(() =>
            Effect.die("failed to create prompts folder in volume")
          )
        );

        const promptPath = yield* Effect.sync(() =>
          path.join(SANDBOX_VOLUME_ROOT, "prompts", "docs-agent.txt")
        );

        const askPromptPath = yield* Effect.sync(() =>
          path.join(SANDBOX_VOLUME_ROOT, "prompts", "ask-agent.txt")
        );

        const configPath = yield* Effect.sync(() =>
          path.join(SANDBOX_VOLUME_ROOT, "opencode.json")
        );

        yield* Effect.all(
          [
            Effect.tryPromise(() =>
              sandbox.fs.uploadFile(
                Buffer.from(DOCS_AGENT_PROMPT(SANDBOX_VOLUME_ROOT)),
                promptPath
              )
            ),
            Effect.tryPromise(() =>
              sandbox.fs.uploadFile(
                Buffer.from(ASK_AGENT_PROMPT),
                askPromptPath
              )
            ),
            Effect.tryPromise(() =>
              sandbox.fs.uploadFile(
                Buffer.from(JSON.stringify(config, null, 2)),
                configPath
              )
            ),
          ],
          { concurrency: 3 }
        ).pipe(
          Effect.catchAll(() =>
            Effect.die("failed to sync config to sandbox volume")
          )
        );

        return {
          configPath,
          promptPath,
          askPromptPath,
        };
      }),
  };
});

class ContextService extends Effect.Service<ContextService>()(
  "ContextService",
  {
    dependencies: [],
    effect: contextService,
  }
) {}

const daytonaService = Effect.gen(function* () {
  const apiKey = yield* Effect.sync(() => env.DAYTONA_API_KEY);

  if (!apiKey) {
    yield* Effect.die("DAYTONA_API_KEY is not set");
  }

  const opencodeApiKey = yield* Effect.sync(() => env.OPENCODE_API_KEY || "");

  const daytona = yield* Effect.sync(
    () => new Daytona({ apiKey, target: "us" })
  );

  yield* Effect.log("Creating image...");

  const image = yield* Effect.sync(() =>
    Image.fromDockerfile(
      path.join(process.cwd(), "src", "lib", "assets", "Dockerfile.daytona")
    )
  );

  const sandbox = yield* Effect.tryPromise(() =>
    daytona.create({
      resources: {
        cpu: 4,
        memory: 8,
        disk: 8,
      },
      image,
      envVars: {
        OPENCODE_CONFIG: path.join(SANDBOX_VOLUME_ROOT, "opencode.json"),
        OPENCODE_API_KEY: opencodeApiKey,
      },
      public: true,
    })
  ).pipe(Effect.catchAll(() => Effect.die("failed to create sandbox")));

  yield* Effect.addFinalizer(() =>
    Effect.all(
      [
        Effect.log("Cleaning up daytona resources..."),
        Effect.tryPromise(() => sandbox.delete()).pipe(
          Effect.catchAll(() => Effect.logError("failed to delete sandbox"))
        ),
      ],
      {
        concurrency: 2,
      }
    )
  );

  const contextService = yield* ContextService;

  return {
    setupContext: () =>
      Effect.gen(function* () {
        yield* Effect.log("Setting up context...");

        yield* contextService.prepareSshAccess({ sandbox });

        const { configPath, promptPath, askPromptPath } =
          yield* contextService.syncConfig({ sandbox });

        yield* Effect.log(`Config written to ${configPath}`);
        yield* Effect.log(`Docs agent prompt written to ${promptPath}`);
        yield* Effect.log(`Ask agent prompt written to ${askPromptPath}`);

        yield* contextService.syncContextRepos({ sandbox });
      }),
    startServer: () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.log("Starting server...");

          const serverFork = yield* pipe(
            Effect.gen(function* () {
              const sessionId = yield* Effect.sync(() => crypto.randomUUID());

              yield* Effect.tryPromise(() =>
                sandbox.process.createSession(sessionId)
              );

              const startResult = yield* Effect.tryPromise(() =>
                sandbox.process.executeSessionCommand(sessionId, {
                  command: "opencode serve --port=8080 --hostname=0.0.0.0",
                })
              );

              const cmdId = startResult.cmdId;

              if (cmdId) {
                const command = yield* Effect.tryPromise(() =>
                  sandbox.process.getSessionCommandLogs(sessionId, cmdId)
                );

                yield* Effect.log("server started", command.output);
              }
            }).pipe(
              Effect.catchAll(() => Effect.die("failed to start server"))
            ),
            Effect.forkDaemon
          );

          yield* Effect.addFinalizer(() =>
            serverFork.pipe(
              Fiber.interrupt,
              Effect.catchAll(() =>
                Effect.logError("failed to interrupt server")
              )
            )
          );

          const previewLink = yield* Effect.tryPromise(() =>
            sandbox.getPreviewLink(8080)
          ).pipe(
            Effect.catchAll(() => Effect.die("failed to get preview link"))
          );

          yield* Effect.log("Server started");

          const sshAccess = yield* Effect.tryPromise(() =>
            sandbox.createSshAccess(60)
          ).pipe(
            Effect.catchAll(() => Effect.die("failed to create ssh access"))
          );

          console.log(
            `\nCONNECT WITH SSH: ssh ${sshAccess.token}@ssh.app.daytona.io\n\n`
          );

          console.log(
            `CONNECT WITH LOCAL TERMINAL: opencode attach ${previewLink.url}`
          );

          yield* Effect.never;
        })
      ),
  };
});

class DaytonaService extends Effect.Service<DaytonaService>()(
  "DaytonaService",
  {
    dependencies: [ContextService.Default],
    scoped: daytonaService,
  }
) {}

const program = Effect.gen(function* () {
  const service = yield* DaytonaService;
  yield* service.setupContext();
  yield* service.startServer();
}).pipe(
  Effect.provide(DaytonaService.Default),
  Effect.onInterrupt(() => Effect.log("Interrupted")),
  Effect.matchCause({
    onSuccess: () => {
      console.log("Daytona service ran successfully");
    },
    onFailure: (cause) => {
      console.error("Failed to run daytona service", cause);
    },
  })
);

const programFiber = Effect.runFork(program);

process.on("SIGINT", async () => {
  console.log("SIGINT received");
  await pipe(programFiber, Fiber.interrupt, Effect.runPromise);
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received");
  await pipe(programFiber, Fiber.interrupt, Effect.runPromise);
  process.exit(0);
});
