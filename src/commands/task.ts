import { localTime } from "../core/format.ts";
import { DevitError } from "../core/errors.ts";
import {
  addComment,
  addTask,
  getTask,
  listComments,
  listTasks,
  parsePriority,
  parseStatus,
  parseTaskId,
  removeTask,
  STATUS_LABELS,
  STATUSES,
  type Status,
  type Task,
  updateTask,
} from "../core/tasks.ts";
import { type Command, type Context, str, table } from "../framework.ts";

function taskLine(t: Task, withProject: boolean): string[] {
  const flags = [t.priority === "high" ? "!" : "", t.pr_url ? "PR" : "", t.issue_url ? "issue" : ""].filter(Boolean).join(" ");
  return [
    `#${t.id}`,
    ...(withProject ? [t.project] : []),
    t.persona ?? "-",
    flags,
    t.title,
  ];
}

function groupedList(tasks: Task[], withProject: boolean): string {
  if (tasks.length === 0) return "No tasks.";
  const rows: string[][] = [];
  for (const status of STATUSES) {
    const group = tasks.filter((t) => t.status === status);
    if (group.length === 0) continue;
    if (rows.length) rows.push([]);
    rows.push([`${STATUS_LABELS[status]} (${group.length})`]);
    for (const t of group) rows.push(["  ", ...taskLine(t, withProject)]);
  }
  // Pad the per-task rows only; group headers are free-standing.
  const taskRows = rows.filter((r) => r.length > 1);
  const formatted = table(taskRows).split("\n");
  let i = 0;
  return rows.map((r) => (r.length > 1 ? formatted[i++]! : r[0] ?? "")).join("\n");
}

function showTask(ctx: Context, t: Task): string {
  const comments = listComments(ctx.db(), t.id);
  const lines = [
    `#${t.id} ${t.title}`,
    `  project:  ${t.project}`,
    `  status:   ${t.status}`,
    `  persona:  ${t.persona ?? "-"}`,
    `  priority: ${t.priority}`,
    `  from:     ${t.created_by}${t.source !== "user" ? ` (${t.source})` : ""}, ${localTime(t.created_at)}`,
  ];
  if (t.issue_url) lines.push(`  issue:    ${t.issue_url}`);
  if (t.pr_url) lines.push(`  PR:       ${t.pr_url}`);
  if (t.body) lines.push("", t.body);
  if (comments.length) {
    lines.push("", "Comments:");
    for (const c of comments) lines.push(`  [${localTime(c.created_at)}] ${c.author}: ${c.body}`);
  }
  return lines.join("\n");
}

/** `none`, `-` or an empty string unassigns. */
function personaValue(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return ["", "-", "none"].includes(value) ? null : value;
}

export const taskCommands: Command[] = [
  {
    path: ["task", "add"],
    summary: "Create a task",
    args: "<title>",
    details: `
Example:
  devit task add "Fix crash on login" --persona dev --status todo --priority high`,
    options: {
      body: { type: "string", short: "b", value: "text", description: "description (markdown)" },
      persona: { type: "string", value: "name", description: "persona responsible for it" },
      status: { type: "string", short: "s", value: "status", description: `initial column: ${STATUSES.join(", ")} (default: backlog)` },
      priority: { type: "string", value: "level", description: "low, normal or high (default: normal)" },
      source: { type: "string", value: "text", description: "where it came from, e.g. a routine name (default: user)" },
    },
    run(ctx) {
      const title = ctx.positionals.join(" ");
      if (!title.trim()) throw new DevitError("a task needs a title", 'devit task add "Title"');
      const priority = str(ctx.values.priority);
      const status = str(ctx.values.status);
      const task = addTask(ctx.db(), {
        projectId: ctx.project().id,
        title,
        body: str(ctx.values.body),
        status: status ? parseStatus(status) : undefined,
        persona: personaValue(str(ctx.values.persona)),
        priority: priority ? parsePriority(priority) : undefined,
        source: str(ctx.values.source) ?? (ctx.actor === "user" ? "user" : "persona"),
        createdBy: ctx.actor,
      });
      ctx.emit(task, () => `Created #${task.id} in ${task.project} (${task.status}): ${task.title}`);
    },
  },
  {
    path: ["task", "list"],
    summary: "List tasks by column (done hidden unless asked)",
    options: {
      status: { type: "string", short: "s", multiple: true, value: "status", description: "only these columns (repeatable)" },
      persona: { type: "string", value: "name", description: "only tasks of this persona (`none` = unassigned)" },
      all: { type: "boolean", short: "a", description: "include done, and every project when outside one" },
    },
    run(ctx) {
      const statuses = (ctx.values.status as string[] | undefined)?.map(parseStatus);
      const all = Boolean(ctx.values.all);
      const project = all && !ctx.values.project ? ctx.maybeProject() : ctx.project();
      const persona = str(ctx.values.persona);
      let tasks = listTasks(ctx.db(), {
        projectId: project?.id,
        statuses: statuses ?? (all ? undefined : STATUSES.filter((s) => s !== "done")),
        persona: persona === "none" ? undefined : persona,
      });
      if (persona === "none") tasks = tasks.filter((t) => t.persona === null);
      ctx.emit(tasks, () => groupedList(tasks, !project));
    },
  },
  {
    path: ["task", "show"],
    summary: "Show a task with its comments",
    args: "<id>",
    run(ctx) {
      const task = getTask(ctx.db(), parseTaskId(ctx.positionals[0]));
      ctx.emit({ ...task, comments: listComments(ctx.db(), task.id) }, () => showTask(ctx, task));
    },
  },
  {
    path: ["task", "move"],
    summary: `Move a task to another column (${STATUSES.join(", ")})`,
    args: "<id> <status>",
    run(ctx) {
      const [id, status] = ctx.positionals;
      if (!status) throw new DevitError("move to which column?", `devit task move <id> <${STATUSES.join("|")}>`);
      const task = updateTask(ctx.db(), parseTaskId(id), { status: parseStatus(status) as Status });
      ctx.emit(task, () => `#${task.id} → ${task.status}`);
    },
  },
  {
    path: ["task", "assign"],
    summary: "Assign a task to a persona (`none` to unassign)",
    args: "<id> <persona>",
    run(ctx) {
      const [id, persona] = ctx.positionals;
      if (persona === undefined) throw new DevitError("assign to which persona?", "devit task assign <id> <persona|none>");
      const task = updateTask(ctx.db(), parseTaskId(id), { persona: personaValue(persona) });
      ctx.emit(task, () => `#${task.id} → ${task.persona ?? "unassigned"}`);
    },
  },
  {
    path: ["task", "edit"],
    summary: "Change a task's title, description or priority",
    args: "<id>",
    options: {
      title: { type: "string", short: "t", value: "text", description: "new title" },
      body: { type: "string", short: "b", value: "text", description: "new description" },
      priority: { type: "string", value: "level", description: "low, normal or high" },
    },
    run(ctx) {
      const priority = str(ctx.values.priority);
      const task = updateTask(ctx.db(), parseTaskId(ctx.positionals[0]), {
        title: str(ctx.values.title),
        body: str(ctx.values.body),
        priority: priority ? parsePriority(priority) : undefined,
      });
      ctx.emit(task, () => `Updated #${task.id}: ${task.title}`);
    },
  },
  {
    path: ["task", "comment"],
    summary: "Add a comment to a task",
    args: "<id> <text>",
    run(ctx) {
      const [id, ...words] = ctx.positionals;
      const comment = addComment(ctx.db(), parseTaskId(id), ctx.actor, words.join(" "));
      ctx.emit(comment, () => `Commented on #${comment.task_id}.`);
    },
  },
  {
    path: ["task", "link"],
    summary: "Attach a GitHub issue or PR to a task (`none` clears it)",
    args: "<id>",
    options: {
      issue: { type: "string", value: "url", description: "issue URL" },
      pr: { type: "string", value: "url", description: "pull request URL" },
    },
    run(ctx) {
      const issue = str(ctx.values.issue);
      const pr = str(ctx.values.pr);
      if (issue === undefined && pr === undefined) throw new DevitError("nothing to link", "pass --issue <url> and/or --pr <url>");
      const clear = (v: string | undefined) => (v === undefined ? undefined : v === "none" ? null : v);
      const task = updateTask(ctx.db(), parseTaskId(ctx.positionals[0]), { issue_url: clear(issue), pr_url: clear(pr) });
      ctx.emit(task, () => `Linked #${task.id}.`);
    },
  },
  {
    path: ["task", "remove"],
    summary: "Delete a task and its comments",
    args: "<id>",
    run(ctx) {
      const id = parseTaskId(ctx.positionals[0]);
      removeTask(ctx.db(), id);
      ctx.emit({ removed: id }, () => `Deleted #${id}.`);
    },
  },
];
