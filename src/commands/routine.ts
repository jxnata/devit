import { localTime } from "../core/format.ts";
import { describeCron, parseCron } from "../core/cron.ts";
import { DevitError } from "../core/errors.ts";
import { getPersona } from "../core/personas.ts";
import {
  addRoutine,
  getRoutine,
  listRoutines,
  recordRoutineRun,
  removeRoutine,
  type Routine,
  setRoutineEnabled,
} from "../core/routines.ts";
import { executeRun, playbookPath } from "../core/runner.ts";
import { listProjects } from "../core/projects.ts";
import { type Command, type Context, str, table } from "../framework.ts";

const when = (iso: string | null) => localTime(iso);

function what(r: Routine): string {
  return [r.playbook ? `playbook ${r.playbook}` : null, r.prompt ? `"${r.prompt.slice(0, 40)}${r.prompt.length > 40 ? "…" : ""}"` : null]
    .filter(Boolean)
    .join(" + ");
}

function nameArg(ctx: Context): string {
  const name = ctx.positionals[0];
  if (!name) throw new DevitError("which routine?", "see `devit routine list`");
  return name;
}

function show(r: Routine): string {
  return [
    `Routine ${r.name}${r.enabled ? "" : " (paused)"}`,
    `  persona:  ${r.persona}`,
    `  project:  ${r.project ?? "none (across projects)"}`,
    `  schedule: ${r.schedule} (${describeCron(parseCron(r.schedule))})`,
    `  does:     ${what(r)}`,
    `  next:     ${r.enabled ? when(r.next_run_at) : "paused"}`,
    `  last:     ${r.last_run_id ? `run #${r.last_run_id} ${r.last_status} at ${when(r.last_run_at)}` : "never"}`,
  ].join("\n");
}

export const routineCommands: Command[] = [
  {
    path: ["routine", "add"],
    summary: "Schedule a persona to run a playbook or prompt on a cron",
    args: "<name>",
    details: `
Routines run while \`devit serve\` is up. A run missed while it was down runs once when it starts.
The schedule is cron in this machine's local time (set TZ to change it):
minute hour day-of-month month day-of-week, or @hourly, @daily, @weekly, @monthly.

Examples:
  devit routine add weekly-report --persona pm --cron "0 9 * * 1" --playbook weekly-report
  devit routine add sentry-triage --persona dev --cron "0 8 * * 1-5" --playbook sentry
  devit routine add friday-summary --persona pm --cron "0 17 * * fri" --global --prompt "Summarize the week across projects"`,
    options: {
      persona: { type: "string", value: "name", description: "who runs it (required)" },
      cron: { type: "string", value: "expr", description: 'when, e.g. "0 9 * * 1" (required)' },
      playbook: { type: "string", value: "name", description: "playbook to follow" },
      prompt: { type: "string", value: "text", description: "what to do, or extra instructions with --playbook" },
      global: { type: "boolean", description: "not tied to the current project" },
    },
    run(ctx) {
      const persona = str(ctx.values.persona);
      const cron = str(ctx.values.cron);
      if (!persona || !cron) throw new DevitError("--persona and --cron are required", 'devit routine add <name> --persona pm --cron "0 9 * * 1" --playbook weekly');
      const project = ctx.values.global ? null : ctx.maybeProject();
      getPersona(persona, project?.path); // fail early on a typo
      const playbook = str(ctx.values.playbook) ?? null;
      if (playbook) playbookPath(playbook, project);
      parseCron(cron);
      const routine = addRoutine(ctx.db(), {
        name: nameArg(ctx),
        persona,
        projectId: project?.id ?? null,
        schedule: cron,
        playbook,
        prompt: str(ctx.values.prompt) ?? null,
      });
      ctx.emit(routine, () => `${show(routine)}\n\nRoutines run while \`devit serve\` is up.`);
    },
  },
  {
    path: ["routine", "list"],
    summary: "List routines with their next run",
    options: { all: { type: "boolean", short: "a", description: "every project, not just the current one" } },
    run(ctx) {
      const db = ctx.db();
      const project = ctx.values.all ? null : ctx.maybeProject();
      const routines = listRoutines(db).filter((r) => !project || r.project_id === project.id || r.project_id === null);
      ctx.emit(routines, () =>
        routines.length === 0
          ? 'No routines. Add one with `devit routine add <name> --persona <p> --cron "0 9 * * 1" --playbook <name>`.'
          : table(
              routines.map((r) => [
                r.name,
                r.persona,
                r.project ?? "-",
                describeCron(parseCron(r.schedule)),
                r.enabled ? when(r.next_run_at) : "paused",
                r.last_run_id ? `#${r.last_run_id} ${r.last_status}` : "-",
                what(r),
              ]),
              ["ROUTINE", "PERSONA", "PROJECT", "SCHEDULE", "NEXT", "LAST", "DOES"],
            ),
      );
    },
  },
  {
    path: ["routine", "show"],
    summary: "Show a routine",
    args: "<name>",
    run(ctx) {
      const routine = getRoutine(ctx.db(), nameArg(ctx));
      ctx.emit(routine, () => show(routine));
    },
  },
  {
    path: ["routine", "run"],
    summary: "Run a routine now, in the foreground (its schedule is unchanged)",
    args: "<name>",
    options: { quiet: { type: "boolean", short: "q", description: "don't stream the agent's progress" } },
    async run(ctx) {
      const db = ctx.db();
      const routine = getRoutine(db, nameArg(ctx));
      const project = routine.project_id === null ? null : (listProjects(db).find((p) => p.id === routine.project_id) ?? null);
      const persona = getPersona(routine.persona, project?.path);
      const stream = !ctx.json && !ctx.values.quiet;
      const controller = new AbortController();
      const interrupt = () => controller.abort();
      process.once("SIGINT", interrupt);
      if (stream) ctx.out(`Running routine ${routine.name} (${persona.name})…`);
      const run = await executeRun({
        db,
        project,
        persona,
        playbook: routine.playbook,
        prompt: routine.prompt,
        routineId: routine.id,
        trigger: "routine",
        signal: controller.signal,
        onStart: (r) => recordRoutineRun(db, routine.id, r.id),
        onEvent: stream ? (line) => ctx.out(line.split("\n").map((l) => `  ${l}`).join("\n")) : undefined,
      });
      process.off("SIGINT", interrupt);
      ctx.emit(run, () => `\nRun #${run.id} ${run.status}${run.summary ? `: ${run.summary}` : ""}${run.error ? `\nerror: ${run.error}` : ""}`);
      if (run.status === "failed") process.exitCode = 1;
    },
  },
  {
    path: ["routine", "pause"],
    summary: "Stop a routine from running until resumed",
    args: "<name>",
    run(ctx) {
      const routine = setRoutineEnabled(ctx.db(), nameArg(ctx), false);
      ctx.emit(routine, () => `Paused ${routine.name}.`);
    },
  },
  {
    path: ["routine", "resume"],
    summary: "Resume a paused routine from its next scheduled time",
    args: "<name>",
    run(ctx) {
      const routine = setRoutineEnabled(ctx.db(), nameArg(ctx), true);
      ctx.emit(routine, () => `Resumed ${routine.name}; next run ${when(routine.next_run_at)}.`);
    },
  },
  {
    path: ["routine", "remove"],
    summary: "Delete a routine (its past runs stay)",
    args: "<name>",
    run(ctx) {
      const name = nameArg(ctx);
      removeRoutine(ctx.db(), name);
      ctx.emit({ removed: name }, () => `Removed routine ${name}.`);
    },
  },
];
