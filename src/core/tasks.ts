import type { Database } from "bun:sqlite";
import { now } from "./db.ts";
import { DevitError } from "./errors.ts";

export const STATUSES = ["backlog", "todo", "doing", "review", "done"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  backlog: "Backlog",
  todo: "To do",
  doing: "Doing",
  review: "Review",
  done: "Done",
};

export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Task {
  id: number;
  project_id: number;
  project: string;
  title: string;
  body: string;
  status: Status;
  persona: string | null;
  priority: Priority;
  source: string;
  created_by: string;
  issue_url: string | null;
  pr_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: number;
  task_id: number;
  author: string;
  body: string;
  created_at: string;
}

export function parseStatus(value: string): Status {
  const v = value.toLowerCase().replace(/[\s_]/g, "");
  const match = STATUSES.find((s) => s === v || STATUS_LABELS[s].toLowerCase().replace(/\s/g, "") === v);
  if (!match) throw new DevitError(`unknown status "${value}"`, `use one of: ${STATUSES.join(", ")}`);
  return match;
}

export function parsePriority(value: string): Priority {
  const v = value.toLowerCase() as Priority;
  if (!PRIORITIES.includes(v)) {
    throw new DevitError(`unknown priority "${value}"`, `use one of: ${PRIORITIES.join(", ")}`);
  }
  return v;
}

export function parseTaskId(value: string | undefined): number {
  const id = Number(String(value ?? "").replace(/^#/, ""));
  if (!Number.isInteger(id) || id <= 0) throw new DevitError(`invalid task id "${value ?? ""}"`);
  return id;
}

const SELECT = `SELECT t.*, p.slug AS project FROM tasks t JOIN projects p ON p.id = t.project_id`;

export function getTask(db: Database, id: number): Task {
  const task = db.query(`${SELECT} WHERE t.id = $id`).get({ id }) as Task | null;
  if (!task) throw new DevitError(`no task #${id}`);
  return task;
}

export interface NewTask {
  projectId: number;
  title: string;
  body?: string;
  status?: Status;
  persona?: string | null;
  priority?: Priority;
  source?: string;
  createdBy?: string;
}

export function addTask(db: Database, input: NewTask): Task {
  const title = input.title.trim();
  if (!title) throw new DevitError("a task needs a title");
  const ts = now();
  const row = db
    .query(
      `INSERT INTO tasks (project_id, title, body, status, persona, priority, source, created_by, created_at, updated_at)
       VALUES ($project_id, $title, $body, $status, $persona, $priority, $source, $created_by, $ts, $ts)
       RETURNING id`,
    )
    .get({
      project_id: input.projectId,
      title,
      body: input.body ?? "",
      status: input.status ?? "backlog",
      persona: input.persona ?? null,
      priority: input.priority ?? "normal",
      source: input.source ?? "user",
      created_by: input.createdBy ?? "user",
      ts,
    }) as { id: number };
  return getTask(db, row.id);
}

export interface TaskFilter {
  projectId?: number;
  statuses?: Status[];
  persona?: string;
}

/** Highest priority first, then oldest first: the order a persona should pick work in. */
export function listTasks(db: Database, filter: TaskFilter = {}): Task[] {
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (filter.projectId !== undefined) {
    where.push("t.project_id = $project_id");
    params.project_id = filter.projectId;
  }
  if (filter.statuses?.length) {
    const keys = filter.statuses.map((s, i) => {
      params[`s${i}`] = s;
      return `$s${i}`;
    });
    where.push(`t.status IN (${keys.join(", ")})`);
  }
  if (filter.persona !== undefined) {
    where.push("t.persona = $persona");
    params.persona = filter.persona;
  }
  const sql = `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.id`;
  return db.query(sql).all(params) as Task[];
}

export type TaskPatch = Partial<
  Pick<Task, "title" | "body" | "status" | "persona" | "priority" | "issue_url" | "pr_url">
>;

export function updateTask(db: Database, id: number, patch: TaskPatch): Task {
  getTask(db, id);
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return getTask(db, id);
  if (patch.title !== undefined && !patch.title.trim()) throw new DevitError("a task needs a title");
  const sets = entries.map(([k]) => `${k} = $${k}`);
  db.query(`UPDATE tasks SET ${sets.join(", ")}, updated_at = $updated_at WHERE id = $id`).run({
    ...Object.fromEntries(entries),
    updated_at: now(),
    id,
  } as Record<string, string | number | null>);
  return getTask(db, id);
}

export function removeTask(db: Database, id: number): void {
  getTask(db, id);
  db.query("DELETE FROM tasks WHERE id = $id").run({ id });
}

export function addComment(db: Database, taskId: number, author: string, body: string): Comment {
  if (!body.trim()) throw new DevitError("a comment needs text");
  getTask(db, taskId);
  const ts = now();
  const comment = db
    .query(
      `INSERT INTO comments (task_id, author, body, created_at) VALUES ($task_id, $author, $body, $ts)
       RETURNING *`,
    )
    .get({ task_id: taskId, author, body: body.trim(), ts }) as Comment;
  db.query("UPDATE tasks SET updated_at = $ts WHERE id = $id").run({ ts, id: taskId });
  return comment;
}

export function listComments(db: Database, taskId: number): Comment[] {
  return db.query("SELECT * FROM comments WHERE task_id = $id ORDER BY id").all({ id: taskId }) as Comment[];
}
