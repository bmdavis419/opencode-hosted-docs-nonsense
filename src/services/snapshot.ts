import { Daytona, Image } from "@daytonaio/sdk";
import { Effect } from "effect";
import type { ContextRepo } from "../config";

export const createSnapshot = (config: ContextRepo) =>
  Effect.gen(function* () {
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
          name: config.snapshotName,
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
              `mkdir -p context/repos && git clone --depth 1 --single-branch --branch ${
                config.branch || "main"
              } ${config.url} context/repos/${config.name}`
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
  });

