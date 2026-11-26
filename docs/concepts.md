# Concepts

## Project

A repo with a `.devit/project.yaml`. Tasks, routines and memory belong to a project. The slug is how you
name it in commands (`-p my-app`).

```
<repo>/.devit/
  project.yaml        slug, name, repo, base branch
  playbooks/          step-by-step instructions for recurring jobs
  personas/           per-project persona overrides (optional)
```

## Task

A card on the board: title, description, column, persona, priority, comments and links to a GitHub issue
or PR. Moving a task to `todo` with a persona assigned is how you tell that persona to work on it.

Comments are how you and the personas talk about a task. When an agent runs a `devit` command, it carries
`DEVIT_PERSONA` in its environment, so comments and tasks it creates are attributed to it.

## Persona

A markdown file with frontmatter: who the agent is, which model it uses, which tools and MCP servers it
may use, its time and cost limits. See [Personas](personas.md). One persona has `lead: true` and answers `devit ask`.

```markdown
---
name: dev
role: Developer
model: opus
timeout_minutes: 45
autopickup: true
allowed_tools: [Bash, Read, Edit, Write]
---
You fix bugs and build features. Open a PR to the base branch; never merge.
```

## Routine (phase 3)

A persona + a playbook + a cron schedule, per project. A routine with nothing new to report ends with
`devit run silent` and leaves no trace on the board.

## Memory

Markdown files, one fact each, in three scopes: global, project and persona. Each scope has a
`MEMORY.md` index that goes into every run's prompt; the agent reads the rest on demand.
See [Runs and memory](runs-and-memory.md).

## Run

One execution of a persona: what triggered it, the status (`running`, `done`, `silent`, `failed`),
the cost and the full log.

## Principles

- **Scripts collect, the model interprets.** Playbooks call scripts that return compact JSON, not raw data.
- **Quiet when there is nothing new.** Routines without news don't notify anyone.
- **Personas talk through tasks and files, not messages.** Each message would wake another agent.
- **A human signs off every public action.** Merges, posts and emails wait in `review`.
