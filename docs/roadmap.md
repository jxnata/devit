# Roadmap

Each phase ends with something usable, and starts only when the previous one meets its "done when".

| Phase | Scope | Done when |
| --- | --- | --- |
| 1. Core | CLI, SQLite, projects and tasks, `devit init`, `doctor`, tests, CI, docs | `task add/list/move` work and tests pass |
| 2. Personas and runner | personas, playbooks, memory in 3 scopes, `devit run`, `run done`/`run silent`, cost and log per run | a persona solves a test task and the run is recorded |
| 3. Daemon and lead | routines with cron, autopickup, timeouts, catch-up of missed routines, `devit ask` | a routine runs on schedule and stays quiet with nothing new |
| 4. Web board | kanban per project, comments, runs page, GitHub issue/PR sync | moving a card to To do makes the persona work |
| 5. Skill and release | `devit` skill for Claude Code and Codex, full docs, release binaries, example personas | someone new installs it and runs a persona in 5 minutes |
| 6. Real-world team | migrate an existing agent team and its routines | the old setup is retired |

Out of scope for now: notifications, auth on the board, multiple users, remote workers, ai-memory
integration.
