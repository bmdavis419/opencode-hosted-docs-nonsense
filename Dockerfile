FROM oven/bun:1 AS base
RUN apt-get update && apt-get install -y git ripgrep && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

RUN bun add -g opencode-ai

ENV NODE_ENV=production
RUN bun run build

FROM base AS release
COPY --from=prerelease /usr/src/app/dist ./dist
COPY --from=prerelease /usr/src/app/package.json ./package.json

RUN bun add -g opencode-ai

EXPOSE 8080/tcp
ENTRYPOINT ["bun", "run", "start"]

