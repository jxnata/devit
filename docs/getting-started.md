# Getting started

## 1. Install

```sh
curl -fsSL https://raw.githubusercontent.com/jxnata/devit/master/install.sh | sh
devit doctor
```

This installs the binary for Linux or macOS (x64 or arm64) to `~/.local/bin`, after checking its
checksum. Set `DEVIT_INSTALL_DIR` to put it elsewhere, or `DEVIT_VERSION=v0.5.0` to pin a version.
Run the same command again to upgrade.

You also need [Claude Code](https://docs.claude.com/en/docs/claude-code) logged in (`claude`), plus
`git`, and the GitHub CLI (`gh`) if you want PRs and GitHub sync.

From source instead (needs [Bun](https://bun.sh) 1.3+):

```sh
git clone https://github.com/jxnata/devit && cd devit
bun install && bun run build
cp dist/devit ~/.local/bin/
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
- **todo**: approved. While `devit serve` runs, a persona with autopickup starts it.
- **doing**: in progress.
- **review**: waiting for you: a PR to merge, a post to approve, a question.
- **done**.

Outside a project folder, pass `-p <slug>`. `devit task list --all` outside a project lists every project.

## 4. Add a persona and run it

Start from a ready-made persona (`devit persona examples` lists them: lead, dev, pm, writer, reviewer):

```sh
devit persona add lead --from lead
devit persona add dev --from dev
```

Open `~/.devit/personas/dev.md` and adjust it. In particular, add the project's commands to
`allowed_tools` (e.g. `"Bash(npm run:*)"`): runs are headless, so the persona can't use anything not
listed there. To start from a blank template instead, use `devit persona add dev --role "Developer"`.
Then:

```sh
devit task add "Fix the typo in the README" --persona dev --status todo
devit run dev --task 1 --dry-run   # see exactly what the agent gets
devit run dev --task 1
devit task show 1                  # its comment, now in review
```

See [Personas](personas.md) and [Runs and memory](runs-and-memory.md).

## 5. Routines, the daemon and the lead

```sh
devit persona add lead --role "Team lead" --lead
devit ask "What should we do next on this project?"
devit routine add weekly --persona lead --cron "0 9 * * 1" --prompt "Review the board and comment a weekly summary"
devit serve        # leave it running (see docs/daemon.md for systemd)
```

Set `autopickup: true` in a persona's file. From then on, moving a task assigned to it into To do is
enough to get it worked on while `devit serve` runs. See [Routines, the daemon and the lead](daemon.md).

## 6. Playbooks

```sh
devit playbook examples                          # weekly-report, friday-summary, sentry-triage, review-queue
devit playbook add weekly-report --from weekly-report
devit routine add weekly --persona pm --cron "0 9 * * 1" --playbook weekly-report
```

## 7. Talk to Devit from Claude Code or Codex

```sh
devit skill install
```

Then ask your coding agent things like "add a task for dev to…" or "what did the team do this week?".
See [Using Devit from Claude Code and Codex](skill.md).

## 8. The board

While `devit serve` runs, open http://127.0.0.1:7420. On a server, reach it through an SSH tunnel or
Cloudflare Tunnel + Access. See [The web board and GitHub sync](board.md).
