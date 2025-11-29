# hosting an opencode instance with access to docs...

I'M WORKING ON A BETTER VERSION: https://github.com/bmdavis419/better-context

## how to use this

0. clone repo
1. run `bun install`
2. setup your .env.local file:

```
# get this from the daytona dashboard
DAYTONA_API_KEY=...

# get this from the opencode zen dashboard (optional)
OPENCODE_API_KEY=sk-...
```

3. Run one of the available commands:

### Starting Sandboxes
These commands start a sandbox environment, setup configuration and SSH access, and start the server.

- `bun run start:svelte` - Start Svelte sandbox
- `bun run start:effect` - Start Effect sandbox
- `bun run start:daytona` - Start Daytona sandbox
- `bun run start:opencode` - Start OpenCode sandbox

To run in the background, append `:bg` to the command name (e.g., `bun run start:svelte:bg`).

### Creating Snapshots
These commands create snapshots of the environments.

- `bun run snapshot:all` - Create snapshots for all environments
- `bun run snapshot:svelte` - Create Svelte snapshot
- `bun run snapshot:effect` - Create Effect snapshot
- `bun run snapshot:daytona` - Create Daytona snapshot
- `bun run snapshot:opencode` - Create OpenCode snapshot

4. connect to the server with the outputs from the terminal
