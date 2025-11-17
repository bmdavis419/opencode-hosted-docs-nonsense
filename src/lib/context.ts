import { Effect, Stream } from "effect";
import { existsSync } from "fs";
import path from "path";

type ContextRepo = {
  name: string;
  url: string;
  branch?: string;
};

export const contextRepos: ContextRepo[] = [
  {
    name: "effect",
    url: "https://github.com/Effect-TS/effect",
    branch: "main",
  },
  {
    name: "svelte",
    url: "https://github.com/sveltejs/svelte.dev",
    branch: "main",
  },
];

const syncRepo = (args: { repo: ContextRepo; reposDir: string }) =>
  Effect.gen(function* () {
    const { repo, reposDir } = args;

    const repoPath = yield* Effect.sync(() => path.join(reposDir, repo.name));

    const exists = yield* Effect.try(() => existsSync(repoPath)).pipe(
      Effect.catchAll(() => Effect.succeed(false))
    );

    let proc: Bun.Subprocess<"ignore", "pipe", "inherit">;

    if (!exists) {
      yield* Effect.log(`Cloning repo ${repo.name}...`);
      proc = yield* Effect.try({
        try: () =>
          Bun.spawn([
            "git",
            "clone",
            "--depth",
            "1",
            "--single-branch",
            "--branch",
            repo.branch || "main",
            repo.url,
            repoPath,
          ]),
        catch: (error) => {
          console.error(error);
          return new Error(`failed to clone repo ${repo.name}`, {
            cause: error,
          });
        },
      });
    } else {
      yield* Effect.log(`Pulling repo ${repo.name}...`);
      proc = yield* Effect.try({
        try: () => Bun.spawn(["git", "pull"], { cwd: repoPath }),
        catch: (error) =>
          new Error(`failed to pull repo ${repo.name}`, { cause: error }),
      });
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (!proc.killed) {
          proc.kill();
        }
      })
    );

    const outputStream = Stream.fromReadableStream({
      evaluate: () => proc.stdout,
      onError: (error) => {
        return new Error(`failed to create output stream`, { cause: error });
      },
    });

    yield* Stream.decodeText(outputStream).pipe(
      Stream.runForEach((item) =>
        Effect.sync(() => {
          console.log(`[${repo.name}] ${item}`);
        })
      )
    );

    yield* Effect.log(`Synced repo ${repo.name}`);

    return {
      name: repo.name,
      path: repoPath,
    };
  });

export const ensureContextRepos = (args: { volumeRoot: string }) =>
  Effect.gen(function* () {
    const { volumeRoot } = args;

    const reposDir = yield* Effect.sync(() =>
      path.join(volumeRoot, "context-repos")
    );

    const syncEffects = contextRepos.map((repo) =>
      syncRepo({ repo, reposDir })
    );

    const sendItems: Effect.Effect.Success<(typeof syncEffects)[number]>[] = [];

    const res = yield* Effect.all(syncEffects, {
      mode: "either",
      concurrency: 5,
    });

    yield* Effect.forEach(res, (result) =>
      Effect.gen(function* () {
        if (result._tag === "Left") {
          yield* Effect.logError(
            `${result.left.name} failed to sync: ${result.left.message}`
          );
        } else {
          sendItems.push(result.right);
        }
      })
    );

    return sendItems;
  });
