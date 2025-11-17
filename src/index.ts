import { Effect, Scope, Stream } from "effect";

const program = Effect.scoped(
  Effect.gen(function* () {
    const scope = yield* Effect.scope;

    const cwd = yield* Effect.sync(() => Bun.env.VOLUME_ROOT);

    if (!cwd) {
      console.error("VOLUME_PATH is not set");
      return Effect.die("VOLUME_PATH is not set");
    }

    yield* Effect.log("cwd:", cwd);

    const proc = yield* Effect.try({
      try: () => Bun.spawn(["opencode", "serve", "--port=5252"]),
      catch: (error) => {
        console.error("failed to spawn opencode server", error);
        return null;
      },
    }).pipe(
      Effect.catchAll(() => Effect.die("failed to spawn opencode server"))
    );

    const cleanupFunc = () => {
      console.log("CLEANING UP");
      proc.kill();
    };

    yield* Scope.addFinalizer(scope, Effect.sync(cleanupFunc));

    yield* Effect.sync(() => {
      const handleSignal = () => {
        cleanupFunc();
        process.exit(0);
      };
      process.on("SIGINT", handleSignal);
      process.on("SIGTERM", handleSignal);
    });

    const outputStream = Stream.fromReadableStream({
      evaluate: () => proc.stdout,
      onError: (error) => {
        console.error("failed to create output stream", error);
        return null;
      },
    });

    yield* Stream.decodeText(outputStream).pipe(
      Stream.runForEach((item) =>
        Effect.sync(() => {
          console.log("output:", item);
        })
      )
    );

    yield* Effect.never;
  })
);

await Effect.runPromise(program);
