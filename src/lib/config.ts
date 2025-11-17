import type { Config } from "@opencode-ai/sdk";
import { Effect } from "effect";
import { contextRepos } from "./context";
import path from "path";

const DOCS_AGENT_PROMPT = (volumeRoot: string) => `
You are an expert internal agent who's job is to answer coding questions and provide accurate and up to date info on different technologies, libraries, frameworks, or tools you're using based on the library codebases you have access to.

Currently you have access to the following codebases at the following paths:

${contextRepos.map((repo) => `- ${repo.name}: ${path.join(volumeRoot, "context-repos", repo.name)}`).join("\n")}

When asked a question regarding one of the codebases, search the codebase to get an accurate answer.

Always search the codebase first before using the web to try to answer the question.

When you are searching the codebase, be very careful that you do not read too much at once. Only read a small amount at a time as you're searching, avoid reading dozens of files at once...

When responding:

- If something about the question is not clear, ask the user to provide more information
- Really try to keep your responses concise, you don't need tons of examples, just one really good one
- Be extremely concise. Sacrifice grammar for the sake of concision.
- When outputting code snippets, include comments that explain what each piece does
- Always bias towards simple practical examples over complex theoretical explanations
- Give your response in markdown format, make sure to have spacing between code blocks and other content

Special instructions for Svelte:

- always use typescript for svelte code (<script lang="ts">)
- if you are just outputting stuff that goes in the script tag, tag the code as typescript code so the syntax highlighting in the view works correctly (AND DO NOT INCLUDE THE SCRIPT TAG IN THE OUTPUT)
- if you are outputting full svelte files (script, markup, styles), tag the code as html so the syntax highlighting in the view works correctly
- always try to answer the questions by just outputting stuff that goes in the script tag, only include markup and styles if absolutely necessary
`;

const ASK_AGENT_PROMPT = `
You are an expert internal agent who's job is to answer coding questions from the user.

When responding:

- If something about the question is not clear, ask the user to provide more information
- Really try to keep your responses concise, you don't need tons of examples, just one really good one
- Be extremely concise. Sacrifice grammar for the sake of concision.
- When outputting code snippets, include comments that explain what each piece does
- Always bias towards simple practical examples over complex theoretical explanations
- Give your response in markdown format, make sure to have spacing between code blocks and other content
`;

export const makeOpencodeConfig = (args: { volumeRoot: string }) =>
  Effect.gen(function* () {
    const { volumeRoot } = args;

    let config: Config = {
      agent: {
        build: {
          disable: true,
        },
        general: {
          disable: true,
        },
        "codebase-docs-agent": {
          disable: true,
        },
        plan: {
          disable: true,
        },
        docs: {
          prompt: "{file:./prompts/docs-agent.txt}",
          disable: false,
          description:
            "Get answers about libraries and frameworks by searching their source code",
          permission: {
            webfetch: "ask",
            edit: "deny",
            bash: "ask",
          },
          mode: "primary",
          tools: {
            write: false,
            bash: true,
            delete: false,
            read: true,
            grep: true,
            glob: true,
            list: true,
            path: false,
            todowrite: false,
            todoread: false,
            websearch: true,
          },
        },
        ask: {
          prompt: "{file:./prompts/ask-agent.txt}",
          disable: false,
          description: "Answer coding questions from the user",
          permission: {
            webfetch: "ask",
            edit: "deny",
            bash: "deny",
          },
          mode: "primary",
          tools: {
            write: false,
            bash: false,
            delete: false,
            read: false,
            grep: false,
            glob: false,
            list: false,
            path: false,
            todowrite: false,
            todoread: false,
            websearch: true,
          },
        },
      },
    };

    const promptPath = yield* Effect.sync(() =>
      path.join(volumeRoot, "prompts", "docs-agent.txt")
    );
    const promptFile = yield* Effect.sync(() => Bun.file(promptPath));

    const askPromptPath = yield* Effect.sync(() =>
      path.join(volumeRoot, "prompts", "ask-agent.txt")
    );
    const askPromptFile = yield* Effect.sync(() => Bun.file(askPromptPath));

    const configPath = yield* Effect.sync(() =>
      path.join(volumeRoot, "opencode.json")
    );
    const configFile = yield* Effect.sync(() => Bun.file(configPath));

    yield* Effect.all([
      Effect.tryPromise({
        try: () => askPromptFile.write(ASK_AGENT_PROMPT),
        catch: (error) => {
          console.error("failed to write ask agent prompt to file", error);
          return null;
        },
      }),
      Effect.tryPromise({
        try: () => configFile.write(JSON.stringify(config, null, 2)),
        catch: (error) => {
          console.error("failed to write docs agent prompt to file", error);
          return null;
        },
      }),
      Effect.tryPromise({
        try: () => promptFile.write(DOCS_AGENT_PROMPT(volumeRoot)),
        catch: (error) => {
          console.error("failed to write docs agent prompt to file", error);
          return null;
        },
      }),
    ]).pipe(
      Effect.catchAll(() =>
        Effect.die("failed to write docs agent prompt to file")
      )
    );

    return {
      configPath,
      promptPath,
      askPromptPath,
    };
  });
