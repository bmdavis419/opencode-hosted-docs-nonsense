import { Effect, Fiber, pipe } from "effect";
import { SandboxService } from "../services/sandbox";
import { contextRepos, SNAPSHOT_NAMES } from "../config";

const program = Effect.gen(function* () {
  const service = yield* SandboxService;

  const config = {
    repoName: "daytona" as const,
    snapshotName: SNAPSHOT_NAMES.daytona,
    repo: contextRepos.daytona,
  };

  const sandbox = yield* service.createSandbox(config);
  yield* service.setupConfig({ sandbox, config });
  yield* service.setupSshAccess({ sandbox });
  yield* service.startServer({ sandbox });
}).pipe(
  Effect.provide(SandboxService.Default),
  Effect.scoped,
  Effect.onInterrupt(() => Effect.log("Interrupted")),
  Effect.matchCause({
    onSuccess: () => {
      console.log("Sandbox ran successfully");
    },
    onFailure: (cause) => {
      console.error("Failed to run sandbox", cause);
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
