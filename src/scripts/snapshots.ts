import { Daytona, Image } from "@daytonaio/sdk";
import { Effect } from "effect";

const SVELTE_SNAPSHOT_NAME = "svelte-docs-snapshot";

export const createSvelteSnapshot = Effect.gen(function* () {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) {
    yield* Effect.die("DAYTONA_API_KEY is not set");
  }

  const daytona = new Daytona({
    apiKey,
  });

  yield* Effect.tryPromise(() =>
    daytona.snapshot.create(
      {
        name: SVELTE_SNAPSHOT_NAME,
        // WTF man
        image: Image.base("debian:stable-slim")
          .runCommands(
            "apt-get update",
            "apt-get install -y git curl unzip && rm -rf /var/lib/apt/lists/*",
            "curl -fsSL https://bun.com/install | bash"
          )
          .dockerfileCommands([
            "ENV BUN_INSTALL=/root/.bun",
            "ENV PATH=$BUN_INSTALL/bin:$PATH",
          ])
          .runCommands(
            "bun add -g opencode-ai@latest",
            "mkdir -p context/repos && git clone --depth 1 --single-branch --branch main https://github.com/sveltejs/svelte.dev context/repos/svelte"
          ),
        resources: {
          cpu: 3,
          memory: 4,
          disk: 3,
        },
      },
      { onLogs: console.log }
    )
  ).pipe(
    Effect.catchAll((err) =>
      Effect.gen(function* () {
        console.error("Failed to create snapshot", err);
        yield* Effect.die("Failed to create snapshot");
      })
    )
  );
}).pipe(
  Effect.matchCause({
    onSuccess: () => {
      console.log("Snapshot created successfully");
      process.exit(0);
    },
    onFailure: (err) => {
      console.error("it died", err);
      process.exit(1);
    },
  })
);

await createSvelteSnapshot.pipe(Effect.runPromise);
