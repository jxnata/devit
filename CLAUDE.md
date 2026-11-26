# Devit

Bun + TypeScript CLI. No runtime dependencies: use Bun built-ins (`bun:sqlite`, `Bun.YAML`, `Bun.serve`,
`node:util` parseArgs) before adding a package.

- `src/core/`: data and domain logic (db, projects, tasks, personas, memory, runs, runner). No printing, no `process.exit`; throw `DevitError`
  (message + optional hint) for anything the user should read.
- `src/web/`: the board (`board.html`, plain JS, no build step) and its JSON API (`server.ts`), served by `devit serve`.
  Check UI changes in a real browser at desktop and phone width, in light and dark.
- `src/commands/`: one file per command group; each command is a `Command` registered in `commands/index.ts`.
  Every command supports `--json` through `ctx.emit(data, humanText)`.
- Schema changes: append to `MIGRATIONS` in `src/core/db.ts`; never edit a shipped migration.
- After changing commands or their help, run `bun run docs` (a test fails if `docs/cli.md` is stale).
- `bun run check` (typecheck + tests) must pass before committing. CLI tests run the real CLI in a sandbox
  (`test/helpers.ts`), with `DEVIT_HOME` in a temp folder. Runner tests use `test/fake-claude.ts`
  (`DEVIT_CLAUDE_BIN`) and `test/fake-gh.ts` (`DEVIT_GH_BIN`); never call the real `claude` or `gh` from tests.
- Example personas and playbooks live in `examples/` and are embedded in the binary (text imports in
  `src/core/examples.ts`); the agent skill is `src/skill/SKILL.md`. Releases: bump `package.json`,
  push a `v<version>` tag, and `.github/workflows/release.yml` builds and publishes the binaries.
- Code, docs and commit messages in English. The plan lives in `docs/roadmap.md`; the board of this
  project is in Devit itself (`devit task list`).
