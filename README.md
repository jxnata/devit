# Devit

A small team of AI agents for your projects.

Devit lets you define **personas** (a developer, a project manager, a writer…), give them **routines**
("every Monday at 8:30, write the weekly report"), share a **memory** between them, and follow their work
on a **kanban board** per project. One persona is the **lead**: it answers your questions and hands work
to the others.

Devit has no LLM runtime of its own. The work runs in a headless coding agent
([Claude Code](https://docs.claude.com/en/docs/claude-code) today, Codex later), with the tools, MCP servers and
skills it already has. Devit decides who runs, when, with which context, and keeps the result.

> **Status: early (v0.5).** Everything in the tour below works, from Linux and macOS binaries. Next up:
> running a real team on it ([roadmap](docs/roadmap.md)). See the [roadmap](docs/roadmap.md).

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/jxnata/devit/master/install.sh | sh
```

This installs a single binary for Linux or macOS. Devit drives [Claude Code](https://docs.claude.com/en/docs/claude-code),
so you need `claude` logged in, plus `git`, and `gh` for GitHub. To build from source, see
[Getting started](docs/getting-started.md).

## Five-minute tour

```sh
cd ~/code/my-app
devit init                                  # creates .devit/project.yaml; commit it
devit task add "Fix crash on login" --persona dev --status todo --priority high
devit task add "Write the launch post"
devit task list                             # the board, by column
devit task comment 1 "Happens only on Android 15"
devit task move 1 review
devit task show 1

devit persona add dev --from dev            # ready-made personas: lead, dev, pm, writer, reviewer
devit run dev --task 1                      # the agent works; the task goes to review
devit runs
devit memory add deploy -d "Deploys go through a PR to main"

devit persona add lead --from lead
devit ask "Split the launch into tasks for dev and writer"
devit routine add weekly --persona lead --cron "0 9 * * 1" --prompt "Write the weekly report as a task comment"
devit serve                                 # routines, autopickup, GitHub sync, board at :7420
```

Every command accepts `--json`, which is what agents use.

## Docs

- [Getting started](docs/getting-started.md)
- [Concepts](docs/concepts.md): projects, tasks, personas, routines, memory
- [Personas](docs/personas.md)
- [Runs and memory](docs/runs-and-memory.md)
- [Routines, the daemon and the lead](docs/daemon.md)
- [The web board and GitHub sync](docs/board.md): including access from another machine
- [Using Devit from Claude Code and Codex](docs/skill.md): `devit skill install`
- [CLI reference](docs/cli.md)
- [Roadmap](docs/roadmap.md)

## Development

```sh
bun install
bun run check     # typecheck + tests
bun run dev -- task list
```

## License

[MIT](LICENSE)
