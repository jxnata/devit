import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { now } from "./db.ts";
import { DevitError } from "./errors.ts";
import { devitHome } from "./paths.ts";

export const RUN_STATUSES = ["running", "done", "silent", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const TRIGGERS = ["manual", "task", "routine", "ask"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export interface Run {
  id: number;
  persona: string;
  project_id: number | null;
  project: string | null;
  task_id: number | null;
  playbook: string | null;
  trigger: Trigger;
  status: RunStatus;
  summary: string | null;
  error: string | null;
  cost_usd: number | null;
  turns: number | null;
  session_id: string | null;
  pid: number | null;
  started_at: string;
  finished_at: string | null;
}

const SELECT = `SELECT r.*, p.slug AS project FROM runs r LEFT JOIN projects p ON p.id = r.project_id`;

export function runLogPath(id: number): string {
  return join(devitHome(), "runs", `${id}.jsonl`);
}

export function getRun(db: Database, id: number): Run {
  const run = db.query(`${SELECT} WHERE r.id = $id`).get({ id }) as Run | null;
  if (!run) throw new DevitError(`no run #${id}`);
  return run;
}

export function createRun(
  db: Database,
  input: { persona: string; projectId: number | null; taskId?: number | null; playbook?: string | null; trigger: Trigger },
): Run {
  const row = db
    .query(
      `INSERT INTO runs (persona, project_id, task_id, playbook, trigger, started_at)
       VALUES ($persona, $project_id, $task_id, $playbook, $trigger, $started_at) RETURNING id`,
    )
    .get({
      persona: input.persona,
      project_id: input.projectId,
      task_id: input.taskId ?? null,
      playbook: input.playbook ?? null,
      trigger: input.trigger,
      started_at: now(),
    }) as { id: number };
  return getRun(db, row.id);
}

/** Called by the agent itself (`devit run done|silent`). Only a running run can be ended this way. */
export function reportRun(db: Database, id: number, status: "done" | "silent", summary: string | null): Run {
  const run = getRun(db, id);
  if (run.status !== "running") throw new DevitError(`run #${id} already ended (${run.status})`);
  db.query("UPDATE runs SET status = $status, summary = $summary WHERE id = $id").run({ id, status, summary });
  return getRun(db, id);
}

export type RunPatch = Partial<Pick<Run, "status" | "summary" | "error" | "cost_usd" | "turns" | "session_id" | "pid" | "finished_at">>;

export function updateRun(db: Database, id: number, patch: RunPatch): Run {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length) {
    db.query(`UPDATE runs SET ${entries.map(([k]) => `${k} = $${k}`).join(", ")} WHERE id = $id`).run({
      ...Object.fromEntries(entries),
      id,
    } as Record<string, string | number | null>);
  }
  return getRun(db, id);
}

export interface RunFilter {
  persona?: string;
  projectId?: number;
  statuses?: RunStatus[];
  limit?: number;
}

export function listRuns(db: Database, filter: RunFilter = {}): Run[] {
  const where: string[] = [];
  const params: Record<string, string | number> = { limit: filter.limit ?? 20 };
  if (filter.persona) {
    where.push("r.persona = $persona");
    params.persona = filter.persona;
  }
  if (filter.projectId !== undefined) {
    where.push("r.project_id = $project_id");
    params.project_id = filter.projectId;
  }
  if (filter.statuses?.length) {
    where.push(`r.status IN (${filter.statuses.map((s, i) => ((params[`s${i}`] = s), `$s${i}`)).join(", ")})`);
  }
  return db
    .query(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.id DESC LIMIT $limit`)
    .all(params) as Run[];
}

/** Runs left `running` by a process that no longer exists (crash, reboot) are marked failed. */
export function reapOrphans(db: Database): number {
  let reaped = 0;
  for (const run of listRuns(db, { statuses: ["running"], limit: 1000 })) {
    if (run.pid && isAlive(run.pid)) continue;
    updateRun(db, run.id, { status: "failed", error: "the run's process exited without reporting", finished_at: now() });
    reaped++;
  }
  return reaped;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
