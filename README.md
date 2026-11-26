# Devit

A small team of AI agents for your projects.

Devit lets you define **personas** (a developer, a project manager, a writer…), give them **routines**
("every Monday at 8:30, write the weekly report"), share a **memory** between them, and follow their work
on a **kanban board** per project. One persona is the **lead**: it answers your questions and hands work
to the others.

Devit has no LLM runtime of its own. The work runs in a headless coding agent
([Claude Code](https://docs.claude.com/en/docs/claude-code) today, Codex later), with the tools, MCP servers and
skills it already has. Devit decides who runs, when, with which context, and keeps the result.

> **Status: early (v0.2).** Projects, the task board, personas, memory and one-off runs work from the CLI.
> Routines, `devit ask`, the web board and the agent skill are next. See the [roadmap](docs/roadmap.md).

## Install

Devit needs [Bun](https://bun.sh) 1.3 or later.

```sh
git clone https://github.com/jxnata/devit && cd devit
bun install
bun run build            # single binary at dist/devit
cp dist/devit ~/.local/bin/
```

Or run it from the checkout with `bun link`, which puts `devit` on your PATH.

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

devit persona add dev --role "Developer" --model opus   # then edit ~/.devit/personas/dev.md
devit run dev --task 1                      # the agent works; the task goes to review
devit runs
devit memory add deploy -d "Deploys go through a PR to main"
```

Every command accepts `--json`, which is what agents use.

## Docs

- [Getting started](docs/getting-started.md)
- [Concepts](docs/concepts.md): projects, tasks, personas, routines, memory
- [Personas](docs/personas.md)
- [Runs and memory](docs/runs-and-memory.md)
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
