import type { Sandbox } from "@daytonaio/sdk";
import { Daytona } from "@daytonaio/sdk";
import { Path } from "@effect/platform";
import { BunPath } from "@effect/platform-bun";
import { env } from "bun";
import { Effect, Fiber, pipe } from "effect";
import {
  ASK_AGENT_PROMPT,
  contextRepos,
  DOCS_AGENT_PROMPT,
  getOpenCodeConfig,
  SANDBOX_VOLUME_ROOT_PATH,
  type RepoName,
} from "../config";

const sandboxService = Effect.gen(function* () {
  const path = yield* Path.Path;
  const apiKey = yield* Effect.sync(() => env.DAYTONA_API_KEY);
  if (!apiKey) {
    yield* Effect.die("DAYTONA_API_KEY is not set");
  }

  const opencodeApiKey = yield* Effect.sync(() => env.OPENCODE_API_KEY || "");
  const runInBackground = yield* Effect.sync(
    () => env.RUN_IN_BACKGROUND === "true"
  );

  const daytona = yield* Effect.sync(
    () => new Daytona({ apiKey, target: "us" })
  );

  return {
    createSandbox: (name: RepoName) =>
      Effect.gen(function* () {
        const config = contextRepos[name];

        yield* Effect.log(
          `Creating sandbox from snapshot ${config.snapshotName}...`
        );

        const sandbox = yield* Effect.tryPromise(() =>
          daytona.create({
            autoStopInterval: 10 * 60,
            snapshot: config.snapshotName,
            envVars: {
              OPENCODE_CONFIG: path.join(
                SANDBOX_VOLUME_ROOT_PATH,
                "opencode.json"
              ),
              OPENCODE_API_KEY: opencodeApiKey,
            },
            public: true,
          })
        ).pipe(Effect.catchAll(() => Effect.die("failed to create sandbox")));

        if (!runInBackground) {
          yield* Effect.addFinalizer(() =>
            Effect.all(
              [
                Effect.log("Cleaning up daytona resources..."),
                Effect.tryPromise(() => sandbox.delete()).pipe(
                  Effect.catchAll(() =>
                    Effect.logError("failed to delete sandbox")
                  )
                ),
              ],
              {
                concurrency: 2,
              }
            )
          );
        }

        return sandbox;
      }),
    setupConfig: (args: { sandbox: Sandbox; name: RepoName }) =>
      Effect.gen(function* () {
        const { sandbox, name } = args;

        yield* Effect.log("Setting up config...");

        yield* Effect.tryPromise(() =>
          sandbox.fs.createFolder(
            path.join(SANDBOX_VOLUME_ROOT_PATH, "prompts"),
            "755"
          )
        ).pipe(
          Effect.catchAll(() =>
            Effect.die("failed to create prompts folder in volume")
          )
        );

        const promptPath = path.join(
          SANDBOX_VOLUME_ROOT_PATH,
          "prompts",
          "docs-agent.txt"
        );
        const askPromptPath = path.join(
          SANDBOX_VOLUME_ROOT_PATH,
          "prompts",
          "ask-agent.txt"
        );
        const configPath = path.join(SANDBOX_VOLUME_ROOT_PATH, "opencode.json");

        yield* Effect.all(
          [
            Effect.tryPromise(() =>
              sandbox.fs.uploadFile(
                Buffer.from(DOCS_AGENT_PROMPT(name)),
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
                Buffer.from(JSON.stringify(getOpenCodeConfig(name), null, 2)),
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

        yield* Effect.log(`Config written to ${configPath}`);
      }),
    setupSshAccess: (args: { sandbox: Sandbox }) =>
      Effect.gen(function* () {
        const { sandbox } = args;

        yield* Effect.log("Preparing ssh access...");

        const bashrcAddon = `
    echo "STARTING..."
    sleep 2
    opencode attach http://localhost:8080
  `;

        const bashrcResult = yield* Effect.tryPromise(() =>
          sandbox.fs.downloadFile("/root/.bashrc")
        ).pipe(Effect.catchAll(() => Effect.die("failed to download .bashrc")));

        const newBashrc = bashrcResult.toString() + bashrcAddon;

        yield* Effect.tryPromise(() =>
          sandbox.fs.uploadFile(Buffer.from(newBashrc), "/root/.bashrc")
        ).pipe(
          Effect.catchAll(() => Effect.die("failed to upload new .bashrc"))
        );
      }),
    startServer: (args: { sandbox: Sandbox }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { sandbox } = args;
          const runInBackground = yield* Effect.sync(
            () => env.RUN_IN_BACKGROUND === "true"
          );

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
            sandbox.createSshAccess(24)
          ).pipe(
            Effect.catchAll(() => Effect.die("failed to create ssh access"))
          );

          console.log(
            `\nCONNECT WITH SSH: ssh ${sshAccess.token}@ssh.app.daytona.io\n\n`
          );

          console.log(
            `CONNECT WITH LOCAL TERMINAL: opencode attach ${previewLink.url}\n\n`
          );

          if (!runInBackground) {
            yield* Effect.never;
          }
        })
      ),
    createAndStartSandbox: (name: RepoName) =>
      Effect.gen(function* () {
        const config = contextRepos[name];

        yield* Effect.log(
          `Creating sandbox from snapshot ${config.snapshotName}...`
        );

        // Create sandbox with 2-hour auto-stop (no finalizers needed)
        const sandbox = yield* Effect.tryPromise(() =>
          daytona.create({
            autoStopInterval: 120, // 2 hours
            snapshot: config.snapshotName,
            envVars: {
              OPENCODE_CONFIG: path.join(
                SANDBOX_VOLUME_ROOT_PATH,
                "opencode.json"
              ),
              OPENCODE_API_KEY: opencodeApiKey,
            },
            public: true,
          })
        ).pipe(Effect.catchAll(() => Effect.die("failed to create sandbox")));

        yield* Effect.log("Setting up config...");

        // Create prompts folder
        yield* Effect.tryPromise(() =>
          sandbox.fs.createFolder(
            path.join(SANDBOX_VOLUME_ROOT_PATH, "prompts"),
            "755"
          )
        ).pipe(
          Effect.catchAll(() =>
            Effect.die("failed to create prompts folder in volume")
          )
        );

        // Upload config files
        const promptPath = path.join(
          SANDBOX_VOLUME_ROOT_PATH,
          "prompts",
          "docs-agent.txt"
        );
        const askPromptPath = path.join(
          SANDBOX_VOLUME_ROOT_PATH,
          "prompts",
          "ask-agent.txt"
        );
        const configPath = path.join(SANDBOX_VOLUME_ROOT_PATH, "opencode.json");

        yield* Effect.all(
          [
            Effect.tryPromise(() =>
              sandbox.fs.uploadFile(
                Buffer.from(DOCS_AGENT_PROMPT(name)),
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
                Buffer.from(JSON.stringify(getOpenCodeConfig(name), null, 2)),
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

        yield* Effect.log("Starting server...");

        // Start server in background using fork (same pattern as startServer)
        yield* pipe(
          Effect.gen(function* () {
            const sessionId = crypto.randomUUID();

            yield* Effect.tryPromise(() =>
              sandbox.process.createSession(sessionId)
            );

            yield* Effect.tryPromise(() =>
              sandbox.process.executeSessionCommand(sessionId, {
                command: "opencode serve --port=8080 --hostname=0.0.0.0",
              })
            );
          }).pipe(Effect.catchAll(() => Effect.die("failed to start server"))),
          Effect.forkDaemon
        );

        // Wait briefly for server to start
        yield* Effect.sleep("2 seconds");

        // Get preview link and SSH access
        const previewLink = yield* Effect.tryPromise(() =>
          sandbox.getPreviewLink(8080)
        ).pipe(Effect.catchAll(() => Effect.die("failed to get preview link")));

        const sshAccess = yield* Effect.tryPromise(() =>
          sandbox.createSshAccess(24)
        ).pipe(
          Effect.catchAll(() => Effect.die("failed to create ssh access"))
        );

        yield* Effect.log("Sandbox ready");

        return {
          previewUrl: previewLink.url,
          sshCommand: `ssh ${sshAccess.token}@ssh.app.daytona.io`,
        };
      }),
  };
});

export class SandboxService extends Effect.Service<SandboxService>()(
  "SandboxService",
  {
    dependencies: [BunPath.layer],
    scoped: sandboxService,
  }
) {}
