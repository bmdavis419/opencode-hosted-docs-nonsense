import { Effect, Scope } from "effect";
import path from "node:path";
import { ensureContextRepos } from "../lib/context";

const program = Effect.scoped(
  Effect.gen(function* () {
    let volumeRoot = yield* Effect.sync(() => Bun.env.VOLUME_ROOT);

    if (!volumeRoot) {
      volumeRoot = yield* Effect.sync(() =>
        path.join(process.cwd(), "dev-vol")
      );
    }

    yield* Effect.log(`Loading context from ${volumeRoot}`);

    const successItems = yield* ensureContextRepos({ volumeRoot });

    yield* Effect.log(`Loaded ${successItems.length} context items`);
  })
);

await Effect.runPromise(program);
