import { join } from "node:path";
import { devitHome } from "../core/paths.ts";
import { localTime, usd } from "../core/format.ts";
import { existsSync, readFileSync } from "node:fs";
import { DevitError } from "../core/errors.ts";
import { getPersona } from "../core/personas.ts";
import { buildPrompt, claudeArgs, claudeBin, executeRun } from "../core/runner.ts";
import { getRun, listRuns, reapOrphans, reportRun, type Run, runLogPath, type RunStatus } from "../core/runs.ts";
import { getTask, parseTaskId } from "../core/tasks.ts";
import { type Command, type Context, str, table } from "../framework.ts";

function currentRunId(): number {
  const id = Number(process.env.DEVIT_RUN_ID);
  if (!Number.isInteger(id) || id <= 0) {
    throw new DevitError("not inside a run", "`devit run done` and `devit run silent` are for agents started by Devit");
  }
  return id;
}

function duration(run: Run): string {
  if (!run.finished_at) return "running";
  const s = Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

function cost(run: Run): string {
  return usd(run.cost_usd);
}

function what(run: Run): string {
  return run.task_id ? `task #${run.task_id}` : run.playbook ? `playbook ${run.playbook}` : run.trigger;
}

function report(ctx: Context, status: "done" | "silent") {
  const run = reportRun(ctx.db(), currentRunId(), status, str(ctx.values.summary) ?? null);
  ctx.emit(run, () => `Run #${run.id} reported ${status}.`);
}

export const runCommands: Command[] = [
  {
    path: ["run"],
    summary: "Run a persona once, on a task, a playbook or a prompt",
    args: "<persona>",
    details: `
Starts the persona's agent (Claude Code, headless) in the project folder and waits for it.
The task, if any, moves to doing, then to review when the run ends (back where it was if it fails).

Examples:
  devit run dev --task 12
  devit run pm --playbook weekly-report
  devit run writer --prompt "Draft three post ideas from last week's search queries"
  devit run dev --task 12 --dry-run      # print the prompt and command, run nothing`,
    options: {
      task: { type: "string", short: "t", value: "id", description: "task to work on" },
      playbook: { type: "string", value: "name", description: "playbook to follow (.devit/playbooks/<name>.md, then ~/.devit/playbooks/)" },
      prompt: { type: "string", value: "text", description: "what to do, or extra instructions with --task/--playbook" },
      "dry-run": { type: "boolean", description: "print the prompt and the agent command instead of running" },
      quiet: { type: "boolean", short: "q", description: "don't stream the agent's progress" },
    },
    async run(ctx) {
      const name = ctx.positionals[0];
      if (!name) throw new DevitError("which persona?", "devit run <persona> --task <id> | --playbook <name> | --prompt <text>");
      const db = ctx.db();
      const project = ctx.maybeProject();
      const persona = getPersona(name, project?.path);
      const taskValue = str(ctx.values.task);
      const task = taskValue ? getTask(db, parseTaskId(taskValue)) : null;
      const job = { project, persona, task, playbook: str(ctx.values.playbook) ?? null, prompt: str(ctx.values.prompt) ?? null };

      if (ctx.values["dry-run"]) {
        // Show where the worktree would go; the real one is created per run.
        const worktree = persona.worktree && project ? { path: join(devitHome(), "worktrees", project.slug, "run-<id>"), base: `origin/${project.base_branch}` } : null;
        const prompt = buildPrompt({ ...job, worktree }, null, db);
        const args = claudeArgs(persona, "<system prompt>");
        ctx.emit({ command: [claudeBin(), ...args], cwd: project?.path ?? null, ...prompt }, () =>
          [
            `$ ${claudeBin()} ${args.map((a) => (/[\s()*]/.test(a) ? JSON.stringify(a) : a)).join(" ")} < prompt`,
            `  cwd: ${project?.path ?? "~/.devit"}`,
            "",
            "--- system prompt (appended) ---",
            prompt.system,
            "",
            "--- prompt ---",
            prompt.user,
          ].join("\n"),
        );
        return;
      }

      const stream = !ctx.json && !ctx.values.quiet;
      if (stream) ctx.out(`Running ${persona.name}${task ? ` on #${task.id}` : ""}…`);
      const controller = new AbortController();
      const interrupt = () => controller.abort();
      process.once("SIGINT", interrupt);
      const run = await executeRun({
        db,
        ...job,
        trigger: task ? "task" : "manual",
        signal: controller.signal,
        onEvent: stream ? (line) => ctx.out(line.split("\n").map((l) => `  ${l}`).join("\n")) : undefined,
      });
      process.off("SIGINT", interrupt);
      ctx.emit(run, () =>
        [
          "",
          `Run #${run.id} ${run.status} in ${duration(run)} (${cost(run)})`,
          ...(run.summary ? [run.summary] : []),
          ...(run.error ? [`error: ${run.error}`] : []),
          `log: ${runLogPath(run.id)}`,
        ].join("\n"),
      );
      if (run.status === "failed") process.exitCode = 1;
    },
  },
  {
    path: ["run", "done"],
    summary: "End the current run with a summary (for agents)",
    options: { summary: { type: "string", short: "s", value: "text", description: "what was done, in one or two sentences" } },
    run(ctx) {
      if (!str(ctx.values.summary)) throw new DevitError("a summary is required", 'devit run done --summary "..."');
      report(ctx, "done");
    },
  },
  {
    path: ["run", "silent"],
    summary: "End the current run with nothing to report (for agents)",
    options: { summary: { type: "string", short: "s", value: "text", description: "optional note for the run log" } },
    run(ctx) {
      report(ctx, "silent");
    },
  },
  {
    path: ["runs"],
    summary: "List recent runs",
    options: {
      persona: { type: "string", value: "name", description: "only this persona" },
      failed: { type: "boolean", description: "only failed runs" },
      status: { type: "string", short: "s", value: "status", description: "running, done, silent or failed" },
      limit: { type: "string", short: "n", value: "n", description: "how many (default 20)" },
      all: { type: "boolean", short: "a", description: "every project, not just the current one" },
    },
    run(ctx) {
      const db = ctx.db();
      reapOrphans(db);
      const status = ctx.values.failed ? "failed" : str(ctx.values.status);
      const project = ctx.values.all ? null : ctx.maybeProject();
      const runs = listRuns(db, {
        persona: str(ctx.values.persona),
        projectId: project?.id,
        statuses: status ? [status as RunStatus] : undefined,
        limit: Number(str(ctx.values.limit) ?? 20),
      });
      ctx.emit(runs, () =>
        runs.length === 0
          ? "No runs yet."
          : table(
              runs.map((r) => [
                `#${r.id}`,
                localTime(r.started_at),
                r.persona,
                r.project ?? "-",
                what(r),
                r.status,
                duration(r),
                cost(r),
                (r.summary ?? r.error ?? "").split("\n")[0]!.slice(0, 80),
              ]),
              ["RUN", "STARTED", "PERSONA", "PROJECT", "WHAT", "STATUS", "TIME", "COST", "SUMMARY"],
            ),
      );
    },
  },
  {
    path: ["runs", "show"],
    summary: "Show a run, optionally with its log",
    args: "<id>",
    options: { log: { type: "boolean", short: "l", description: "print the agent's raw event log (JSON lines)" } },
    run(ctx) {
      const id = Number(String(ctx.positionals[0] ?? "").replace(/^#/, ""));
      if (!Number.isInteger(id) || id <= 0) throw new DevitError(`invalid run id "${ctx.positionals[0] ?? ""}"`);
      const run = getRun(ctx.db(), id);
      const logFile = runLogPath(run.id);
      if (ctx.values.log) {
        if (!existsSync(logFile)) throw new DevitError(`no log for run #${run.id}`);
        ctx.out(readFileSync(logFile, "utf8"));
        return;
      }
      ctx.emit({ ...run, log: logFile }, () =>
        [
          `Run #${run.id}: ${run.persona} on ${what(run)} (${run.project ?? "no project"})`,
          `  status:  ${run.status}`,
          `  started: ${localTime(run.started_at, true)} (${run.trigger})`,
          `  time:    ${duration(run)}`,
          `  cost:    ${cost(run)}${run.turns ? `, ${run.turns} turns` : ""}`,
          ...(run.session_id ? [`  session: ${run.session_id}`] : []),
          `  log:     ${logFile}`,
          ...(run.summary ? ["", run.summary] : []),
          ...(run.error ? ["", `error: ${run.error}`] : []),
        ].join("\n"),
      );
    },
  },
];
