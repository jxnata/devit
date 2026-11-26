# Concepts

## Project

A repo with a `.devit/project.yaml`. Tasks, routines and memory belong to a project. The slug is how you
name it in commands (`-p my-app`).

```
<repo>/.devit/
  project.yaml        slug, name, repo, base branch
  playbooks/          step-by-step instructions for routines (phase 2)
  personas/           per-project persona overrides (phase 2, optional)
```

## Task

A card on the board: title, description, column, persona, priority, comments and links to a GitHub issue
or PR. Moving a task to `todo` with a persona assigned is how you tell that persona to work on it.

Comments are how you and the personas talk about a task. When an agent runs a `devit` command, it carries
`DEVIT_PERSONA` in its environment, so comments and tasks it creates are attributed to it.

## Persona (phase 2)

A markdown file with frontmatter: who the agent is, which model it uses, which tools and MCP servers it
may use, how many turns it gets. One persona has `lead: true` and answers `devit ask`.

```markdown
---
name: dev
role: Developer
model: opus
max_turns: 60
autopickup: true
allowed_tools: [Bash, Read, Edit, Write]
---
You fix bugs and build features. Open a PR to the base branch; never merge.
```

## Routine (phase 3)

A persona + a playbook + a cron schedule, per project. A routine with nothing new to report ends with
`devit run silent` and leaves no trace on the board.

## Memory (phase 2)

Markdown files, one fact each, in three scopes: global, project and persona. Each scope has a
`MEMORY.md` index that goes into every run's prompt; the agent reads the rest on demand.

## Run (phase 2)

One execution of a persona: what triggered it, the status, the cost and the full log.

## Principles

- **Scripts collect, the model interprets.** Playbooks call scripts that return compact JSON, not raw data.
- **Quiet when there is nothing new.** Routines without news don't notify anyone.
- **Personas talk through tasks and files, not messages.** Each message would wake another agent.
- **A human signs off every public action.** Merges, posts and emails wait in `review`.
