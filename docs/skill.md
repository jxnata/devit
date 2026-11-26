# Using Devit from Claude Code and Codex

Devit ships a skill: instructions that teach a coding agent to drive Devit for you. Once it's installed,
an interactive Claude Code or Codex session understands requests like these:

- "add a task for dev to fix the login redirect, high priority"
- "what did the team do this week? anything failing?"
- "ask the lead to plan the pricing page and split it into tasks"
- "remember for the team that deploys go through a PR to main"
- "create a routine for pm to write the weekly report on Mondays at 9"

## Install

```sh
devit skill install                 # Claude Code, plus Codex and ~/.agents if they are installed
devit skill install --for codex     # one agent: claude, codex, agents or all
devit skill install --repo          # into the current project (.claude/skills/devit/…), to commit
devit skill show                    # read it
devit skill uninstall
```

The skill goes in `~/.claude/skills/devit/SKILL.md` and the matching folder for each agent. Run
`devit skill install` again after upgrading Devit to get the new version. It reports `updated` when the
file changed.

## How it behaves

- The agent works **for you**: tasks and comments it creates are attributed to `user`. It doesn't use
  `devit run done` or `devit run silent`, which are only for runs Devit starts.
- It reads the board with `--json` before acting, and uses the backlog when it isn't sure the work is
  approved. Moving a task to To do for a persona with autopickup starts real work.
- It confirms before `devit run`, because a run costs money and can change the repo.
- It leaves merging, deploying and publishing to you, as the personas do.

The skill is the same file for every agent and is generated from
[`src/skill/SKILL.md`](../src/skill/SKILL.md). A test checks that every command it mentions exists.
