# Personas

A persona is a markdown file: YAML frontmatter for its settings, the body for its instructions.

- Global personas live in `~/.devit/personas/<name>.md` and work in every project.
- A project can override one with `<repo>/.devit/personas/<name>.md` (same name, whole file replaced).

Start from an example (`devit persona examples`: lead, dev, pm, writer, reviewer), or from the blank
template, and edit the file:

```sh
devit persona add dev --from dev
devit persona add writer --from writer --model opus
devit persona add dev --role "Developer" --model opus
devit persona add pm --role "Project manager" --lead
devit persona show dev
```

## Example

```markdown
---
role: "Developer"
lead: false
model: opus
effort: high
autopickup: true
worktree: true
allowed_tools:
  - "Bash(devit:*)"
  - "Bash(git:*)"
  - "Bash(gh pr create:*)"
  - "Bash(bun:*)"
  - Read
  - Grep
  - Glob
  - Edit
  - Write
disallowed_tools:
  - "Bash(git push --force:*)"
timeout_minutes: 45
max_budget_usd: 5
---
You fix bugs and build features in this repo.

- Create a branch from the base branch, make the change, run the checks, open a PR to the base branch.
- Never merge. Comment on the task with the PR link.
- If the task is unclear, ask in a comment and finish.
```

## Settings

| Field | Default | What it does |
| --- | --- | --- |
| `role` | the name | One line shown to the other personas |
| `lead` | `false` | The lead answers `devit ask` and hands out work. One per setup |
| `model` | Claude Code's default | Model alias (`opus`, `sonnet`, `haiku`) or full id |
| `effort` | default | `low`, `medium`, `high`, `xhigh`, `max` |
| `autopickup` | `false` | Works on tasks moved to `todo` and assigned to it (with `devit serve`) |
| `allowed_tools` | Devit, Read, Grep, Glob | Tools allowed without asking. `Bash(devit:*)` is always added |
| `disallowed_tools` | none | Tools always denied |
| `permission_mode` | default | `acceptEdits`, `auto`, `bypassPermissions`, `dontAsk`, `plan` |
| `mcp_config` | none | MCP config files, relative to the persona file |
| `max_budget_usd` | none | Stops the run past this cost |
| `timeout_minutes` | `30` | Kills the run after this long |
| `worktree` | `false` | Runs in its own git worktree of the base branch (freshly fetched), not in your checkout. Use it for personas that change files: your working copy never switches branch, and two personas can work on one repo at once. The worktree is removed after the run unless it has uncommitted changes |

Runs are headless: nobody is there to approve a tool, so anything outside `allowed_tools` is denied.
Allow what the persona needs and no more. `bypassPermissions` allows everything; use it only in a sandbox.

## What the agent receives

`devit run <persona> ... --dry-run` prints the exact command and prompt. In short:

- **System prompt** (appended to Claude Code's): the persona's instructions, the project (path, repo, base
  branch), how to use the `devit` CLI, the rules (finish with `run done` or `run silent`, never merge or
  publish), the memory indexes and the other personas.
- **Prompt**: the task with its comments, or the playbook, plus `--prompt` text.
- **Environment**: `DEVIT_RUN_ID`, `DEVIT_PERSONA`, `DEVIT_PROJECT`, `DEVIT_TASK_ID`, so every `devit`
  command it runs is attributed to it.
- **Working directory**: the project's repo. Its `CLAUDE.md`, skills and MCP settings apply as usual.

## Playbooks

A playbook is the step-by-step for a recurring job, in markdown, at `<repo>/.devit/playbooks/<name>.md`
(or `~/.devit/playbooks/<name>.md` for every project):

```sh
devit run pm --playbook weekly-report
```

Keep collection in scripts that print compact JSON, and keep the playbook about what to look at and what
to do with it.
