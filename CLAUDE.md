# Devit

Bun + TypeScript CLI. No runtime dependencies: use Bun built-ins (`bun:sqlite`, `Bun.YAML`, `Bun.serve`,
`node:util` parseArgs) before adding a package.

- `src/core/`: data and domain logic (db, projects, tasks, personas, memory, runs, runner). No printing, no `process.exit`; throw `DevitError`
  (message + optional hint) for anything the user should read.
- `src/commands/`: one file per command group; each command is a `Command` registered in `commands/index.ts`.
  Every command supports `--json` through `ctx.emit(data, humanText)`.
- Schema changes: append to `MIGRATIONS` in `src/core/db.ts`; never edit a shipped migration.
- After changing commands or their help, run `bun run docs` (a test fails if `docs/cli.md` is stale).
- `bun run check` (typecheck + tests) must pass before committing. CLI tests run the real CLI in a sandbox
  (`test/helpers.ts`), with `DEVIT_HOME` in a temp folder. Runner tests use `test/fake-claude.ts`
  (`DEVIT_CLAUDE_BIN`); never call the real `claude` from tests.
- Code, docs and commit messages in English. The plan lives in `docs/roadmap.md`; the board of this
  project is in Devit itself (`devit task list`).
