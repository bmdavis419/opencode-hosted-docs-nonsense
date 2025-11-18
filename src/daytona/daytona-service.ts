import { Daytona, Image, Sandbox } from "@daytonaio/sdk";
import { env } from "bun";
import path from "node:path";
import { Effect, Fiber, pipe } from "effect";
import { ContextService } from "./context-service";

const SANDBOX_VOLUME_ROOT = "/context";

const daytonaService = Effect.gen(function* () {
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

  yield* Effect.log("Creating image...");

  const image = yield* Effect.sync(() =>
    Image.fromDockerfile(
      path.join(process.cwd(), "src", "lib", "assets", "Dockerfile.daytona")
    )
  );

  const sandbox = yield* Effect.tryPromise(() =>
    daytona.create({
      resources: {
        cpu: 2,
        memory: 3,
        disk: 4,
      },
      autoStopInterval: 0,
      image,
      envVars: {
        OPENCODE_CONFIG: path.join(SANDBOX_VOLUME_ROOT, "opencode.json"),
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
            Effect.catchAll(() => Effect.logError("failed to delete sandbox"))
          ),
        ],
        {
          concurrency: 2,
        }
      )
    );
  }

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
  };
});

export class DaytonaService extends Effect.Service<DaytonaService>()(
  "DaytonaService",
  {
    dependencies: [ContextService.Default],
    scoped: daytonaService,
  }
) {}

