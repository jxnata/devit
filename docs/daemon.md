# Routines, the daemon and the lead

## Routines

A routine is a persona that runs a playbook, a prompt or both on a cron schedule. It belongs to the
current project, or to no project with `--global`.

```sh
devit routine add weekly-report --persona pm --cron "0 9 * * 1" --playbook weekly-report
devit routine add sentry-triage --persona dev --cron "0 8 * * 1-5" --playbook sentry-triage
devit routine add friday-summary --persona pm --cron "0 17 * * fri" --global \
  --prompt "Summarize what got done this week across projects"

devit routine list           # schedule, next run, last result
devit routine run weekly-report   # run it now, in the foreground; the schedule is unchanged
devit routine pause sentry-triage
devit routine resume sentry-triage
devit routine remove friday-summary
```

The schedule has five fields, `minute hour day-of-month month day-of-week`, in the machine's local time
(set `TZ` for another one). It supports `*`, lists (`1,15`), ranges (`1-5`), steps (`*/15`), names
(`mon`, `jan`), and `@hourly`, `@daily`, `@weekly`, `@monthly`. When both day fields are set, either one
matches, as in classic cron.

A routine with nothing new should end with `devit run silent`. Write the playbook so that "nothing to
report" is a normal outcome. For example: "If there are no new Sentry issues since the last run, run
`devit run silent`." Silent runs still show up in `devit runs`, but they leave nothing on the board.

## `devit serve`

Routines and autopickup only happen while the daemon is running:

```sh
devit serve                       # every 30 s: start what is due
devit serve --interval 10 --max-parallel 2
devit serve --once                # one pass, wait for it, exit (for system cron or CI)
```

On each pass it starts:

1. **Routines whose time came.** Missed runs are not replayed one by one. If the daemon was down
   through several runs, the routine runs once when the daemon comes back, and then follows its
   schedule from there. Resuming a paused routine works the same way: it continues from its next
   scheduled time.
2. **Autopickup tasks.** These are tasks in **To do** assigned to a persona with `autopickup: true`,
   highest priority first. If the run fails, the task moves to the **backlog** with a comment saying
   why, so a broken task is not retried forever. Move it back to To do to try again.

A persona does one thing at a time. `--max-parallel` caps how many runs happen at once across
personas. When the daemon starts, it marks runs left `running` by a crash as failed, and their tasks
go back to the backlog.

Ctrl-C or `SIGTERM` interrupts the running agents and records those runs as failed (`interrupted`)
before the daemon exits. Only one daemon runs per `DEVIT_HOME`, and its pid is in `~/.devit/serve.pid`.

### Keep it running with systemd

`~/.config/systemd/user/devit.service`:

```ini
[Unit]
Description=Devit daemon
After=network-online.target

[Service]
ExecStart=%h/.local/bin/devit serve
Restart=on-failure
# The agents need the same PATH and credentials as your shell (claude, gh, git):
Environment=PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=%h

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now devit
journalctl --user -u devit -f      # the daemon's log
loginctl enable-linger "$USER"     # keep it running after you log out (servers)
```

On macOS, run `devit serve` from a launchd agent, or from a terminal you leave open.

## `devit ask`: talking to the lead

```sh
devit ask "What is in review, and what is blocked?"
devit ask "Plan the pricing page and split it into tasks for dev and writer"
devit ask --continue "Make the dev task high priority and move it to To do"
devit ask --persona writer "Which posts did best last month?"
```

`devit ask` runs the lead persona (`lead: true`) on your message, in the current project or across
projects outside one, and prints its answer. The lead's prompt tells it to coordinate: it turns requests
into tasks for the persona that fits and follows the board. A task it puts in To do for a persona with
autopickup gets worked on by the daemon.

`--continue` resumes the last `ask` conversation in the same place, using the Claude session, so the
lead remembers what you just said. Every `ask` is a run like any other, so you can find it in
`devit runs --persona <lead>`.
