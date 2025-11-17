import { Effect } from "effect";
import path from "node:path";
import { ensureContextRepos } from "../lib/context";
import { makeOpencodeConfig } from "../lib/config";

const program = Effect.scoped(
  Effect.gen(function* () {
    let volumeRoot = yield* Effect.sync(() => Bun.env.VOLUME_ROOT);

    if (!volumeRoot) {
      volumeRoot = yield* Effect.sync(() =>
        path.join(process.cwd(), "dev-vol")
      );
    }

    yield* Effect.log(`Setting up config & agent prompt...`);

    const { configPath, promptPath, askPromptPath } = yield* makeOpencodeConfig(
      {
        volumeRoot,
      }
    );

    yield* Effect.log(`Config written to ${configPath}`);
    yield* Effect.log(`Docs agent prompt written to ${promptPath}`);
    yield* Effect.log(`Ask agent prompt written to ${askPromptPath}`);

    yield* Effect.log(`Loading context into ${volumeRoot}`);

    const successItems = yield* ensureContextRepos({ volumeRoot });

    yield* Effect.log(`Loaded ${successItems.length} context items`);
  })
);

await Effect.runPromise(program);
