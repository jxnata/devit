# Getting started

## 1. Install

```sh
git clone https://github.com/jxnata/devit && cd devit
bun install && bun run build
cp dist/devit ~/.local/bin/
devit doctor
```

`devit doctor` checks the data folder, the database, the current project and the tools Devit drives
(`claude`, `git`, `gh`).

Devit keeps its data in `~/.devit/`. Set `DEVIT_HOME` to use another folder.

## 2. Add a project

Inside any repo:

```sh
devit init
```

This writes `.devit/project.yaml` and registers the project on your machine:

```yaml
slug: my-app
name: "my-app"
repo: acme/my-app        # from the origin remote, if it is on GitHub
base_branch: develop     # develop if it exists, else the default branch
```

Commit the `.devit/` folder. Anyone who clones the repo and runs a `devit` command inside it gets the
project registered automatically.

Override what was detected with `--slug`, `--name`, `--base` and `--repo`.

## 3. Use the board

```sh
devit task add "Add dark mode" --body "Follow the system setting" --priority high
devit task list
devit task move 1 todo
devit task assign 1 dev
devit task comment 1 "Start with the settings screen"
devit task show 1
```

Columns: `backlog` → `todo` → `doing` → `review` → `done`.

- **backlog**: ideas, and tasks routines create, not yet approved.
- **todo**: approved. A persona with autopickup starts it (with `devit serve`, coming in phase 3).
- **doing**: in progress.
- **review**: waiting for you: a PR to merge, a post to approve, a question.
- **done**.

Outside a project folder, pass `-p <slug>`. `devit task list --all` outside a project lists every project.

## 4. Add a persona and run it

```sh
devit persona add dev --role "Developer" --model sonnet
```

Open `~/.devit/personas/dev.md`, write its instructions and allow the tools it needs (it can only read
files until you do). Then:

```sh
devit task add "Fix the typo in the README" --persona dev --status todo
devit run dev --task 1 --dry-run   # see exactly what the agent gets
devit run dev --task 1
devit task show 1                  # its comment, now in review
```

See [Personas](personas.md) and [Runs and memory](runs-and-memory.md).
