import { Sandbox } from "@daytonaio/sdk";
import path from "node:path";
import { Effect } from "effect";
import {
  ASK_AGENT_PROMPT,
  config,
  contextRepos,
  DOCS_AGENT_PROMPT,
  type ContextRepo,
} from "./config";
import type { ExecuteResponse } from "@daytonaio/sdk/src/types/ExecuteResponse";

const SANDBOX_VOLUME_ROOT = "/context";

const contextService = Effect.gen(function* () {
  const bashrcAddon = `
    echo "STARTING..."
    sleep 2
    opencode attach http://localhost:8080
  `;

  const syncRepo = (args: {
    repo: ContextRepo;
    reposDir: string;
    sandbox: Sandbox;
  }) =>
    Effect.gen(function* () {
      const { repo, reposDir, sandbox } = args;

      const exists = yield* Effect.tryPromise(() =>
        sandbox.fs.listFiles(reposDir)
      ).pipe(
        Effect.map((files) =>
          files.some((f) => f.isDir && f.name === repo.name)
        )
      );

      const repoPath = yield* Effect.sync(() => path.join(reposDir, repo.name));

      let response: ExecuteResponse;

      if (exists) {
        response = yield* Effect.tryPromise({
          try: () => sandbox.process.executeCommand(`git pull`, repoPath),
          catch: (err) => console.error("failed to pull repo", repo.name, err),
        });
      } else {
        response = yield* Effect.tryPromise({
          try: () =>
            sandbox.process.executeCommand(
              `git clone --depth 1 --single-branch --branch ${repo.branch || "main"} ${repo.url} ${repoPath}`
            ),
          catch: (err) => console.error("failed to clone repo", repo.name, err),
        });
      }

      yield* Effect.log(`Synced repo ${repo.name}`, response.result);
    });

  return {
    prepareSshAccess: (args: { sandbox: Sandbox }) =>
      Effect.gen(function* () {
        const { sandbox } = args;

        yield* Effect.log("Preparing ssh access...");

        const bashrcResult = yield* Effect.tryPromise(() =>
          sandbox.fs.downloadFile("/root/.bashrc")
        ).pipe(Effect.catchAll(() => Effect.die("failed to download .bashrc")));

        const newBashrc = bashrcResult.toString() + bashrcAddon;

        yield* Effect.tryPromise(() =>
          sandbox.fs.uploadFile(Buffer.from(newBashrc), "/root/.bashrc")
        ).pipe(
          Effect.catchAll(() => Effect.die("failed to upload new .bashrc"))
        );

        yield* Effect.log("Ssh access prepared");
      }),
    syncContextRepos: (args: { sandbox: Sandbox }) =>
      Effect.gen(function* () {
        const { sandbox } = args;

        yield* Effect.log("Syncing context repos...");

        const reposDir = yield* Effect.sync(() =>
          path.join(SANDBOX_VOLUME_ROOT, "repos")
        );

        yield* Effect.tryPromise(() =>
          sandbox.fs.createFolder(reposDir, "755")
        );

        yield* Effect.all(
          contextRepos.map((repo) => syncRepo({ repo, reposDir, sandbox })),
          {
            concurrency: 5,
            mode: "default",
          }
        ).pipe(Effect.catchAll(() => Effect.void));
      }),
    syncConfig: (args: { sandbox: Sandbox }) =>
      Effect.gen(function* () {
        const { sandbox } = args;

        yield* Effect.log("Syncing config...");

        yield* Effect.tryPromise(() =>
          sandbox.fs.createFolder(
            path.join(SANDBOX_VOLUME_ROOT, "prompts"),
            "755"
          )
        ).pipe(
          Effect.catchAll(() =>
            Effect.die("failed to create prompts folder in volume")
          )
        );

        const promptPath = yield* Effect.sync(() =>
          path.join(SANDBOX_VOLUME_ROOT, "prompts", "docs-agent.txt")
        );

        const askPromptPath = yield* Effect.sync(() =>
          path.join(SANDBOX_VOLUME_ROOT, "prompts", "ask-agent.txt")
        );

        const configPath = yield* Effect.sync(() =>
          path.join(SANDBOX_VOLUME_ROOT, "opencode.json")
        );

        yield* Effect.all(
          [
            Effect.tryPromise(() =>
              sandbox.fs.uploadFile(
                Buffer.from(DOCS_AGENT_PROMPT(SANDBOX_VOLUME_ROOT)),
                promptPath
              )
            ),
            Effect.tryPromise(() =>
              sandbox.fs.uploadFile(
                Buffer.from(ASK_AGENT_PROMPT),
                askPromptPath
              )
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
          Effect.catchAll(() =>
            Effect.die("failed to sync config to sandbox volume")
          )
        );

        return {
          configPath,
          promptPath,
          askPromptPath,
        };
      }),
  };
});

export class ContextService extends Effect.Service<ContextService>()(
  "ContextService",
  {
    dependencies: [],
    effect: contextService,
  }
) {}

