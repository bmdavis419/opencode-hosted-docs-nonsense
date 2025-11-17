import { Effect, Stream } from "effect";
import path from "node:path";

const program = Effect.scoped(
  Effect.gen(function* () {
    let volumeRoot = yield* Effect.sync(() => Bun.env.VOLUME_ROOT);

    if (!volumeRoot) {
      volumeRoot = yield* Effect.sync(() =>
        path.join(process.cwd(), "dev-vol")
      );
    }

    const configPath = yield* Effect.sync(() =>
      path.join(volumeRoot, "opencode.json")
    );

    const proc = yield* Effect.try({
      try: () =>
        Bun.spawn(["opencode", "serve", "--port=8080"], {
          env: {
            ...Bun.env,
            OPENCODE_CONFIG: configPath,
          },
        }),
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

    yield* Effect.addFinalizer(() => Effect.sync(cleanupFunc));

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
          console.log(item);
        })
      )
    );

    yield* Effect.never;
  })
);

await Effect.runPromise(program);
