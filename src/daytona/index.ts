import { Effect, Fiber, pipe } from "effect";
import { DaytonaService } from "./daytona-service";

const program = Effect.gen(function* () {
  const service = yield* DaytonaService;
  yield* service.setupContext();
  yield* service.startServer();

  process.exit(0);
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
