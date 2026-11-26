---
name: devit
description: Drive Devit, the user's team of AI personas, from this session — the per-project task board (kanban), personas, routines, shared memory, runs and the lead persona. Use when the user mentions Devit, the board, tasks/cards for the team, a persona (lead, dev, pm, writer…), routines, `devit ask`, or asks to hand work to the team, see what the team did, or remember something for the team.
---

# Devit

Devit runs a team of AI personas on the user's projects: a kanban board per project, personas that work
tasks and routines headless (Claude Code), shared memory, and a lead persona that coordinates. You drive
it through the `devit` CLI. Every command takes `--json`; use it when you need to read the output.

Here you act **for the user**, in an interactive session. Things you create are attributed to the user.
Don't run `devit run done` or `devit run silent`. Those are only for agents that Devit started.

## Find your bearings

```sh
devit doctor --json                 # is it set up? (home, database, claude, gh)
devit project list --json           # registered projects
devit task list --json              # the board of the project in the current folder (-p <slug> elsewhere)
devit persona list --json           # who is on the team; the lead has "lead": true
```

A project is a repo with `.devit/project.yaml`. Run `devit init` in a repo to add one. Commands act on
the project of the current folder, or on `-p <slug>`.

## The board

Columns: `backlog` (ideas, not approved) → `todo` (approved) → `doing` → `review` → `done`.

```sh
devit task add "Outcome-focused title" --body "context, acceptance criteria, files" [--persona dev] [--status todo] [--priority high]
devit task show 12 --json           # with comments
devit task move 12 todo
devit task assign 12 dev            # or none
devit task comment 12 "text"
devit task edit 12 --title "..." --body "..."
devit task link 12 --pr <url>       # or --issue <url>
```

**Moving a task to `todo` with a persona that has `autopickup: true` makes that persona start working on
it** (while `devit serve` runs). Do it only when the user wants the work done. When unsure, use the
backlog.

## Hand work to the team

- One-off, now, in the foreground: `devit run <persona> --task 12`, or `--prompt "..."`, or
  `--playbook <name>`. Add `--dry-run` to see the exact prompt without running anything. Runs cost money
  and change the repo (a PR at most), so confirm with the user unless they asked for it.
- Through the lead: `devit ask "plan X and split it into tasks"`. Add `--continue` to follow up.
- Recurring: `devit routine add weekly-report --persona pm --cron "0 9 * * 1" --playbook weekly-report`,
  then `devit routine list`, `run`, `pause`, `resume`, `remove`.

## See what the team did

```sh
devit runs --json [-n 20] [--persona dev] [--failed]
devit runs show 7 --json            # summary, error, cost; --log for the raw agent events
devit routine list --json
```

## Memory

Memory is one fact per entry, in three scopes: `global`, `project` (the default inside a project) and
`persona`. Every run gets the index of what's in memory. Save things the team will need again:
conventions, decisions, where things are. Never save secrets.

```sh
devit memory add release-process -d "one-line description" -b "details" [-s global|project|persona --persona dev]
devit memory list --json
devit memory search "deploy" --json
devit memory show release-process
```

## Personas and playbooks

Personas are markdown files in `~/.devit/personas/` (global) or `.devit/personas/` (per project). The
frontmatter holds the settings (model, tools, autopickup, limits) and the body holds the instructions.
Playbooks are markdown steps in `.devit/playbooks/` or `~/.devit/playbooks/`.

```sh
devit persona examples              # ready-made: lead, dev, pm, writer, reviewer
devit persona add dev --from dev    # copy an example, then edit the file
devit playbook list
devit playbook add weekly-report --from weekly-report
```

Runs are headless, so a persona can only use the tools in its `allowed_tools`. To make a persona able to
do something, edit that list.

## The daemon and the board UI

`devit serve` runs the routines on schedule, picks up tasks, syncs GitHub every 15 minutes, and serves
the web board at http://127.0.0.1:7420. It is usually a systemd user service, so check before starting
another one.

## Rules

- Public or irreversible actions (merging, deploying, publishing, sending) stay with the human. Personas
  leave them in Review, and so should you.
- Prefer the CLI to editing `~/.devit/devit.db` directly. Never edit the database by hand.
- Full docs: https://github.com/jxnata/devit/tree/master/docs
