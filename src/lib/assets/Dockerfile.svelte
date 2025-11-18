FROM oven/bun:1
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN bun add -g opencode-ai@latest
WORKDIR /context
RUN mkdir -p repos && git clone --depth 1 --single-branch --branch main https://github.com/sveltejs/svelte.dev repos/svelte
