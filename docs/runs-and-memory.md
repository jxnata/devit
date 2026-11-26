# Runs and memory

## Running a persona

```sh
devit run dev --task 12                       # work on a task
devit run pm --playbook weekly-report         # follow a playbook
devit run writer --prompt "Three post ideas"  # free text
devit run dev --task 12 --dry-run             # show the command and prompt, run nothing
```

What happens:

1. A run is recorded and, with `--task`, the task moves to **doing**.
2. The agent runs in the repo (`claude -p`), streaming its progress to your terminal and to
   `~/.devit/runs/<id>.jsonl`.
3. The agent ends with `devit run done --summary "..."` or `devit run silent`.
4. Devit records status, cost, turns and session id, then settles the task:

| Run ended | Task (if still in doing) |
| --- | --- |
| done | → review, for you to check |
| silent | → back where it was |
| failed (error, timeout) | → back where it was, with a comment saying why |

An agent that forgets to report still counts as done, with its final message as the summary.
If the agent moved the task itself, Devit leaves it there.

```sh
devit runs                     # recent runs in this project (-a for all)
devit runs --failed
devit runs show 7              # details
devit runs show 7 --log        # raw event log
```

Resume a run's conversation in Claude Code with `claude --resume <session id>`.

## Memory

Facts worth knowing next time, as markdown files, one fact each, in three scopes:

| Scope | Folder | For |
| --- | --- | --- |
| global | `~/.devit/memory/global/` | you, your conventions, things true everywhere |
| project | `~/.devit/memory/projects/<slug>/` | this project's decisions, gotchas, where things are |
| persona | `~/.devit/memory/personas/<name>/` | how one persona does its job |

```sh
devit memory add release-process -d "How releases ship" -b "PR develop → main, merge commit, never squash"
devit memory add tone -s persona --persona writer -d "Write plainly, no hype"
devit memory list
devit memory show release-process
devit memory search squash
devit memory remove release-process
```

Each scope keeps a `MEMORY.md` index (name + description). Every run gets the indexes of the global scope,
its project and its persona; the agent reads full entries with `devit memory show`. So keep descriptions
specific: they decide whether an entry gets read.

Memory stays on your machine, outside the repo: what agents learn about your business never lands in a
public commit.
