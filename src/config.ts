import type { Config } from "@opencode-ai/sdk";
import path from "node:path";

export type ContextRepo = {
  name: string;
  url: string;
  branch?: string;
};

export const contextRepos = {
  effect: {
    name: "effect",
    url: "https://github.com/Effect-TS/effect",
    branch: "main",
  },
  opencode: {
    name: "opencode",
    url: "https://github.com/sst/opencode",
    branch: "production",
  },
  svelte: {
    name: "svelte",
    url: "https://github.com/sveltejs/svelte.dev",
    branch: "main",
  },
  daytona: {
    name: "daytona",
    url: "https://github.com/daytonaio/daytona",
    branch: "main",
  },
} as const;

export const SNAPSHOT_NAMES = {
  effect: "effect-docs-snapshot",
  opencode: "opencode-docs-snapshot",
  svelte: "svelte-docs-snapshot",
  daytona: "daytona-docs-snapshot",
} as const;

export type RepoName = keyof typeof contextRepos;
export type SnapshotName = (typeof SNAPSHOT_NAMES)[RepoName];
export type RepoConfig = (typeof contextRepos)[RepoName];

const SANDBOX_VOLUME_ROOT = "/context";

export const DOCS_AGENT_PROMPT = (repoName: RepoName) => `
You are an expert internal agent who's job is to answer coding questions and provide accurate and up to date info on different technologies, libraries, frameworks, or tools you're using based on the library codebases you have access to.

Currently you have access to the following codebase at the following path:

- ${repoName}: ${path.join(SANDBOX_VOLUME_ROOT, "repos", repoName)}

When asked a question regarding the codebase, search the codebase to get an accurate answer.

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

export const ASK_AGENT_PROMPT = `
You are an expert internal agent who's job is to answer coding questions from the user.

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

export const getOpenCodeConfig = (repoName: RepoName): Config => ({
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
      model: "opencode/big-pickle",
      description:
        "Get answers about libraries and frameworks by searching their source code",
      permission: {
        webfetch: "ask",
        edit: "deny",
        bash: "allow",
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
      model: "opencode/big-pickle",
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
});

export const SANDBOX_VOLUME_ROOT_PATH = SANDBOX_VOLUME_ROOT;
