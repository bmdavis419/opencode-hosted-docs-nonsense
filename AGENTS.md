# Agent Guidelines for opencode-daytona-scratch

## Build & Test Commands

- **Run code**: `bun src/index.ts`
- **Type check**: `bunx tsc --noEmit`
- **No test suite** - this is a minimal project focused on the Daytona SDK

## Code Style Guidelines

### TypeScript & Strict Mode

- All code uses **TypeScript with strict mode enabled** (`strict: true`)
- Type annotations are required (implicit `any` is forbidden)
- Use `ESNext` target for latest language features
- Enable `verbatimModuleSyntax` - import types with `import type`

### Imports

- Use ES modules (`type: "module"`)
- Preserve module syntax - don't transform imports/exports
- Import types explicitly: `import type { Foo } from 'module'`
- Order imports: standard library → dependencies → relative imports

### Naming Conventions

- **Files**: camelCase or kebab-case
- **Exported items**: PascalCase for types/classes, camelCase for functions/variables
- **Constants**: UPPER_SNAKE_CASE if truly constant

### Error Handling

- Use Effect library for error handling (dependency included)
- Avoid throwing errors - use Result/Either patterns when possible
- Provide context in error messages

### Dependencies

- **Runtime**: `@daytonaio/sdk` (Daytona platform integration), `effect` (error handling)
- **Development**: TypeScript 5+, Bun toolchain
- Minimize dependencies - prefer standard library when possible

### Formatting

- Use Bun's built-in formatting (no explicit formatter config)
- Indentation: 2 spaces
- Semicolons: required
- Line length: no hard limit but favor readability

## Notes

- This is a Bun project (not Node.js) - use Bun APIs when applicable
- No Cursor or Copilot rules files present in this repository

## Daytona Context

- The full Daytona open source codebase is available in `daytona-repo/`
- Use this source code as context when answering questions about Daytona internals or usage
- This is a git subtree clone of https://github.com/daytonaio/daytona
