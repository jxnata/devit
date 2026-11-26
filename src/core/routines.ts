import type { Database } from "bun:sqlite";
import { parseCron, nextRun } from "./cron.ts";
import { now } from "./db.ts";
import { DevitError } from "./errors.ts";
import type { RunStatus } from "./runs.ts";

/** A persona's recurring job: a playbook and/or prompt on a cron schedule, in a project or across projects. */
export interface Routine {
  id: number;
  name: string;
  persona: string;
  project_id: number | null;
  project: string | null;
  project_path: string | null;
  schedule: string;
  playbook: string | null;
  prompt: string | null;
  enabled: 0 | 1;
  next_run_at: string;
  last_run_id: number | null;
  last_status: RunStatus | null;
  last_run_at: string | null;
  created_at: string;
}

const SELECT = `SELECT r.*, p.slug AS project, p.path AS project_path, l.status AS last_status, l.started_at AS last_run_at
  FROM routines r
  LEFT JOIN projects p ON p.id = r.project_id
  LEFT JOIN runs l ON l.id = r.last_run_id`;

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function nextRunAt(schedule: string, after: Date = new Date()): string {
  return nextRun(parseCron(schedule), after).toISOString();
}

export function getRoutine(db: Database, name: string): Routine {
  const routine = db.query(`${SELECT} WHERE r.name = $name`).get({ name }) as Routine | null;
  if (!routine) throw new DevitError(`no routine "${name}"`, "see `devit routine list --all`");
  return routine;
}

export interface NewRoutine {
  name: string;
  persona: string;
  projectId: number | null;
  schedule: string;
  playbook?: string | null;
  prompt?: string | null;
}

export function addRoutine(db: Database, input: NewRoutine): Routine {
  if (!NAME_RE.test(input.name)) {
    throw new DevitError(`invalid routine name "${input.name}"`, "use a short kebab-case slug, e.g. weekly-report");
  }
  if (!input.playbook && !input.prompt) {
    throw new DevitError("a routine needs something to do", "pass --playbook <name> and/or --prompt <text>");
  }
  if (db.query("SELECT 1 FROM routines WHERE name = $name").get({ name: input.name })) {
    throw new DevitError(`routine "${input.name}" already exists`, "remove it first, or pick another name");
  }
  db.query(
    `INSERT INTO routines (name, persona, project_id, schedule, playbook, prompt, next_run_at, created_at)
     VALUES ($name, $persona, $project_id, $schedule, $playbook, $prompt, $next, $now)`,
  ).run({
    name: input.name,
    persona: input.persona,
    project_id: input.projectId,
    schedule: input.schedule.trim(),
    playbook: input.playbook ?? null,
    prompt: input.prompt ?? null,
    next: nextRunAt(input.schedule),
    now: now(),
  });
  return getRoutine(db, input.name);
}

export function listRoutines(db: Database): Routine[] {
  return db.query(`${SELECT} ORDER BY r.enabled DESC, r.next_run_at, r.name`).all() as Routine[];
}

export function setRoutineEnabled(db: Database, name: string, enabled: boolean): Routine {
  const routine = getRoutine(db, name);
  // Resuming starts from now: no burst of runs for the time it was paused.
  db.query("UPDATE routines SET enabled = $enabled, next_run_at = $next WHERE id = $id").run({
    id: routine.id,
    enabled: enabled ? 1 : 0,
    next: enabled ? nextRunAt(routine.schedule) : routine.next_run_at,
  });
  return getRoutine(db, name);
}

export function removeRoutine(db: Database, name: string): void {
  const routine = getRoutine(db, name);
  db.query("DELETE FROM routines WHERE id = $id").run({ id: routine.id });
}

/** Enabled routines whose time has come (including ones missed while nothing was running). */
export function dueRoutines(db: Database, at: Date = new Date()): Routine[] {
  return db.query(`${SELECT} WHERE r.enabled = 1 AND r.next_run_at <= $at ORDER BY r.next_run_at`).all({
    at: at.toISOString(),
  }) as Routine[];
}

/**
 * Claims a routine for this tick: schedules its next run after `at`, so missed runs collapse
 * into one. Returns false if someone else already claimed it.
 */
export function claimRoutine(db: Database, routine: Routine, at: Date = new Date()): boolean {
  const res = db
    .query("UPDATE routines SET next_run_at = $next WHERE id = $id AND next_run_at = $current")
    .run({ id: routine.id, current: routine.next_run_at, next: nextRunAt(routine.schedule, at) });
  return res.changes === 1;
}

export function recordRoutineRun(db: Database, routineId: number, runId: number): void {
  db.query("UPDATE routines SET last_run_id = $run WHERE id = $id").run({ id: routineId, run: runId });
}
