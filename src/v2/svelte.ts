import { Daytona } from "@daytonaio/sdk";
import { env } from "bun";
import path from "node:path";
import { Effect, Fiber, pipe } from "effect";
import { ASK_AGENT_PROMPT, config, DOCS_AGENT_PROMPT } from "../daytona/config";

const SVELTE_SNAPSHOT_NAME = "svelte-docs-snapshot";
const SANDBOX_VOLUME_ROOT = "/context";

const program = Effect.gen(function* () {
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

  yield* Effect.log("Creating sandbox from snapshot...");

  const sandbox = yield* Effect.tryPromise(() =>
    daytona.create({
      autoStopInterval: 0,
      snapshot: SVELTE_SNAPSHOT_NAME,
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

  yield* Effect.log("Setting up config...");

  // Setup config and prompts
  yield* Effect.tryPromise(() =>
    sandbox.fs.createFolder(path.join(SANDBOX_VOLUME_ROOT, "prompts"), "755")
  ).pipe(
    Effect.catchAll(() =>
      Effect.die("failed to create prompts folder in volume")
    )
  );

  const promptPath = path.join(
    SANDBOX_VOLUME_ROOT,
    "prompts",
    "docs-agent.txt"
  );
  const askPromptPath = path.join(
    SANDBOX_VOLUME_ROOT,
    "prompts",
    "ask-agent.txt"
  );
  const configPath = path.join(SANDBOX_VOLUME_ROOT, "opencode.json");

  yield* Effect.all(
    [
      Effect.tryPromise(() =>
        sandbox.fs.uploadFile(
          Buffer.from(DOCS_AGENT_PROMPT(SANDBOX_VOLUME_ROOT)),
          promptPath
        )
      ),
      Effect.tryPromise(() =>
        sandbox.fs.uploadFile(Buffer.from(ASK_AGENT_PROMPT), askPromptPath)
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
    Effect.catchAll(() => Effect.die("failed to sync config to sandbox volume"))
  );

  yield* Effect.log(`Config written to ${configPath}`);

  // Setup SSH access
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
  ).pipe(Effect.catchAll(() => Effect.die("failed to upload new .bashrc")));

  // Start server
  yield* Effect.log("Starting server...");

  const serverFork = yield* pipe(
    Effect.gen(function* () {
      const sessionId = yield* Effect.sync(() => crypto.randomUUID());

      yield* Effect.tryPromise(() => sandbox.process.createSession(sessionId));

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
    }).pipe(Effect.catchAll(() => Effect.die("failed to start server"))),
    Effect.forkDaemon
  );

  yield* Effect.addFinalizer(() =>
    serverFork.pipe(
      Fiber.interrupt,
      Effect.catchAll(() => Effect.logError("failed to interrupt server"))
    )
  );

  const previewLink = yield* Effect.tryPromise(() =>
    sandbox.getPreviewLink(8080)
  ).pipe(Effect.catchAll(() => Effect.die("failed to get preview link")));

  yield* Effect.log("Server started");

  const sshAccess = yield* Effect.tryPromise(() =>
    sandbox.createSshAccess(24)
  ).pipe(Effect.catchAll(() => Effect.die("failed to create ssh access")));

  console.log(
    `\nCONNECT WITH SSH: ssh ${sshAccess.token}@ssh.app.daytona.io\n\n`
  );

  console.log(
    `CONNECT WITH LOCAL TERMINAL: opencode attach ${previewLink.url}\n\n`
  );

  if (!runInBackground) {
    yield* Effect.never;
  }
}).pipe(
  Effect.scoped,
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
