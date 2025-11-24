import { Effect } from "effect";
import { SandboxService } from "./services/sandbox";
import { contextRepos, type RepoName } from "./config";

const validNames = Object.keys(contextRepos) as RepoName[];

const server = Bun.serve({
  port: 8080,
  idleTimeout: 120, // 2 minutes for sandbox creation
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health check / list sandboxes
    if (path === "/" && req.method === "GET") {
      return Response.json({
        available: validNames,
        usage: "POST /sandbox/:name to create a sandbox",
      });
    }

    // Create sandbox
    if (path.startsWith("/sandbox/") && req.method === "POST") {
      const name = path.replace("/sandbox/", "") as RepoName;

      if (!validNames.includes(name)) {
        return Response.json(
          { error: `Invalid sandbox name. Valid: ${validNames.join(", ")}` },
          { status: 400 }
        );
      }

      try {
        const program = Effect.gen(function* () {
          const service = yield* SandboxService;
          return yield* service.createAndStartSandbox(name);
        }).pipe(Effect.provide(SandboxService.Default), Effect.scoped);

        const result = await Effect.runPromise(program);

        return Response.json({
          url: result.previewUrl,
          ssh: result.sshCommand,
        });
      } catch (error) {
        console.error("Failed to create sandbox:", error);
        return Response.json(
          { error: "Failed to create sandbox" },
          { status: 500 }
        );
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`Server listening on http://localhost:${server.port}`);
