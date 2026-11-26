import type { Database } from "bun:sqlite";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { now } from "./db.ts";
import { DevitError } from "./errors.ts";
import { memoryIndex, visibleScopes } from "./memory.ts";
import { devitHome, PROJECT_DIR } from "./paths.ts";
import { listPersonas, type Persona } from "./personas.ts";
import type { Project } from "./projects.ts";
import { createRun, getRun, type Run, runLogPath, type Trigger, updateRun } from "./runs.ts";
import { addComment, getTask, listComments, type Status, type Task, updateTask } from "./tasks.ts";

// ---------- playbooks ----------

export function playbookPath(name: string, project: Project | null): string {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name)) throw new DevitError(`invalid playbook name "${name}"`);
  const candidates = [
    ...(project ? [join(project.path, PROJECT_DIR, "playbooks", `${name}.md`)] : []),
    join(devitHome(), "playbooks", `${name}.md`),
  ];
  const found = candidates.find((f) => existsSync(f));
  if (!found) throw new DevitError(`no playbook "${name}"`, `looked in: ${candidates.join(", ")}`);
  return found;
}

// ---------- prompt ----------

export interface Job {
  project: Project | null;
  persona: Persona;
  task?: Task | null;
  playbook?: string | null;
  /** Free text: the whole job, or extra instructions on top of a task or playbook. */
  prompt?: string | null;
}

const LEAD_GUIDE = `You are the lead. You coordinate the team: turn requests into tasks for the persona that fits (\`devit task add "..." --persona <name> --status todo\`), follow up on the board, and answer questions about the work. Do specialized work yourself only when no persona fits or it is quick.`;

const CLI_GUIDE = `Use the \`devit\` CLI to report and coordinate. Your persona, project and run are already set in the environment, so don't pass them.
- \`devit task list --json\`, \`devit task show <id> --json\`: the board
- \`devit task add "title" --body "..." [--persona <name>] [--status todo]\`: create follow-up work (backlog unless it is clearly approved)
- \`devit task comment <id> "text"\`: talk about a task; questions for the human go here
- \`devit task move <id> <backlog|todo|doing|review|done>\`, \`devit task assign <id> <persona|none>\`, \`devit task link <id> --pr <url>\`
- \`devit memory add <name> --description "one line" --body "..." [--scope global|project|persona]\`: save a durable fact worth knowing next time (kebab-case name; same name replaces it)
- \`devit memory show <name>\`, \`devit memory search <term>\`: read what was saved

Finish every run with exactly one of:
- \`devit run done --summary "what you did, in one or two sentences"\`
- \`devit run silent\` when there was nothing new to do or report

Rules:
- Nobody watches this run and nobody can answer mid-run. If you need a decision, comment on the task, move it to review and finish.
- Never merge, deploy, publish or send anything public yourself: leave it in review for the human.
- Never write secrets in tasks, comments or memory.`;

export function buildPrompt(job: Job, runId: number | null, db: Database): { system: string; user: string } {
  const { project, persona, task } = job;
  const others = listPersonas(project?.path)
    .filter((p) => p.name !== persona.name)
    .map((p) => `- ${p.name}: ${p.role}${p.lead ? " (lead)" : ""}`);
  const where = project
    ? `Project: ${project.name} (\`${project.slug}\`) at ${project.path}. GitHub repo: ${project.repo ?? "none"}. Base branch for PRs: ${project.base_branch}.`
    : "No project: you are working across projects.";
  const system = [
    persona.instructions,
    "# Working in Devit",
    `You are "${persona.name}" (${persona.role}), a persona in Devit, running headless${runId ? ` as run #${runId}` : ""}. Today is ${new Date().toISOString().slice(0, 10)}.`,
    where,
    CLI_GUIDE,
    ...(persona.lead ? [LEAD_GUIDE] : []),
    "# Memory",
    "Indexes only; read an entry with `devit memory show <name>`.",
    memoryIndex(visibleScopes(project?.slug, persona.name)),
    ...(others.length ? ["# Other personas", others.join("\n")] : []),
  ].join("\n\n");

  const parts: string[] = [];
  if (task) {
    const comments = listComments(db, task.id);
    parts.push(
      `Work on task #${task.id}: ${task.title}`,
      ...(task.body ? [task.body] : []),
      ...(task.issue_url ? [`Issue: ${task.issue_url}`] : []),
      ...(task.pr_url ? [`PR: ${task.pr_url}`] : []),
      ...(comments.length ? ["Comments so far:", comments.map((c) => `- ${c.author}: ${c.body}`).join("\n")] : []),
      "When you finish, comment on the task with what changed (link the PR if there is one). It goes to review on its own; move it only if it belongs elsewhere.",
    );
  }
  if (job.playbook) {
    const file = playbookPath(job.playbook, project);
    parts.push(`Follow the playbook "${job.playbook}":`, readFileSync(file, "utf8").trim());
  }
  if (job.prompt) parts.push(task || job.playbook ? `Also: ${job.prompt}` : job.prompt);
  if (parts.length === 0) throw new DevitError("nothing to do", "pass --task <id>, --playbook <name> or --prompt <text>");
  return { system, user: parts.join("\n\n") };
}

// ---------- claude ----------

export function claudeBin(): string {
  return process.env.DEVIT_CLAUDE_BIN || "claude";
}

export function claudeArgs(persona: Persona, system: string, resume?: string | null): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--append-system-prompt", system];
  if (resume) args.push("--resume", resume);
  if (persona.model) args.push("--model", persona.model);
  if (persona.effort) args.push("--effort", persona.effort);
  if (persona.permission_mode) args.push("--permission-mode", persona.permission_mode);
  if (persona.max_budget_usd) args.push("--max-budget-usd", String(persona.max_budget_usd));
  const allowed = [...new Set(["Bash(devit:*)", ...persona.allowed_tools])];
  args.push("--allowedTools", ...allowed);
  if (persona.disallowed_tools.length) args.push("--disallowedTools", ...persona.disallowed_tools);
  if (persona.mcp_config.length) {
    const base = dirname(persona.file);
    args.push("--mcp-config", ...persona.mcp_config.map((f) => (isAbsolute(f) ? f : resolve(base, f))));
  }
  return args;
}

// ---------- events ----------

/** A short, human line for a stream-json event, or null to skip it. */
export function describeEvent(event: any): string | null {
  if (event?.type === "assistant") {
    const lines: string[] = [];
    for (const block of event.message?.content ?? []) {
      if (block.type === "text" && block.text?.trim()) lines.push(block.text.trim());
      if (block.type === "tool_use") {
        const input = block.input ?? {};
        const detail = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.description ?? "";
        lines.push(`→ ${block.name}${detail ? `: ${String(detail).split("\n")[0]!.slice(0, 120)}` : ""}`);
      }
    }
    return lines.length ? lines.join("\n") : null;
  }
  return null;
}

/** A run's log, read back: the human lines and the agent's final message. */
export function readRunLog(id: number, maxLines = 400): { events: string[]; output: string | null } {
  const file = runLogPath(id);
  if (!existsSync(file)) return { events: [], output: null };
  const events: string[] = [];
  let output: string | null = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "result" && typeof event.result === "string") output = event.result.trim() || null;
    const text = describeEvent(event);
    if (text) events.push(text);
  }
  return { events: events.slice(-maxLines), output };
}

// ---------- run ----------

export interface ExecuteOptions extends Job {
  db: Database;
  trigger: Trigger;
  routineId?: number | null;
  /** Claude session to continue (`--resume`). */
  resume?: string | null;
  /** Where the task goes if the run fails. Default: back where it was. */
  failStatus?: Status;
  /** Aborting kills the agent; the run is recorded as failed ("interrupted"). */
  signal?: AbortSignal;
  onStart?: (run: Run) => void;
  onEvent?: (line: string) => void;
}

export type RunResult = Run & {
  /** The agent's final message. */
  output: string | null;
};

/**
 * Runs a persona once: records the run, moves its task to doing, streams the agent's
 * output to runs/<id>.jsonl, then settles the run and the task.
 */
export async function executeRun(opts: ExecuteOptions): Promise<RunResult> {
  const { db, persona, project } = opts;
  let task = opts.task ?? null;
  if (task && project && task.project_id !== project.id) {
    throw new DevitError(`task #${task.id} belongs to project "${task.project}"`);
  }
  const run = createRun(db, {
    persona: persona.name,
    projectId: project?.id ?? null,
    taskId: task?.id ?? null,
    playbook: opts.playbook ?? null,
    routineId: opts.routineId ?? null,
    trigger: opts.trigger,
  });
  opts.onStart?.(run);
  let prompt: { system: string; user: string };
  try {
    prompt = buildPrompt(opts, run.id, db);
  } catch (err) {
    updateRun(db, run.id, { status: "failed", error: (err as Error).message, finished_at: now() });
    throw err;
  }
  const previousStatus: Status | null = task?.status ?? null;
  if (task) task = updateTask(db, task.id, { status: "doing" });

  const logFile = runLogPath(run.id);
  mkdirSync(dirname(logFile), { recursive: true });
  const log = createWriteStream(logFile);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    DEVIT_HOME: devitHome(),
    DEVIT_RUN_ID: String(run.id),
    DEVIT_PERSONA: persona.name,
    // A compiled devit is the running binary; put its folder first so the agent calls the same one.
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
  };
  if (project) env.DEVIT_PROJECT = project.slug;
  else delete env.DEVIT_PROJECT;
  if (task) env.DEVIT_TASK_ID = String(task.id);
  delete env.CLAUDECODE; // a nested `claude -p` refuses to start inside a Claude Code session otherwise

  let result: any = null;
  let error: string | null = null;
  let exitCode: number | null = null;
  let timedOut = false;
  let interrupted = false;
  let onAbort: (() => void) | null = null;
  try {
    if (opts.signal?.aborted) throw new Error("interrupted");
    const child = Bun.spawn([claudeBin(), ...claudeArgs(persona, prompt.system, opts.resume)], {
      cwd: project?.path ?? devitHome(),
      env,
      stdin: new TextEncoder().encode(prompt.user),
      stdout: "pipe",
      stderr: "pipe",
    });
    updateRun(db, run.id, { pid: child.pid });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, persona.timeout_minutes * 60_000);
    onAbort = () => {
      interrupted = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const stderr = new Response(child.stderr).text();
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        log.write(`${line}\n`);
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "result") result = event;
        const text = describeEvent(event);
        if (text) opts.onEvent?.(text);
      }
    }
    exitCode = await child.exited;
    clearTimeout(timer);
    const errText = (await stderr).trim();
    if (interrupted) error = "interrupted";
    else if (timedOut) error = `timed out after ${persona.timeout_minutes} min`;
    else if (exitCode !== 0) error = errText.split("\n").slice(-5).join("\n") || `agent exited with code ${exitCode}`;
    else if (result?.is_error) error = String(result.result ?? result.subtype ?? "agent reported an error");
  } catch (err) {
    error = (err as NodeJS.ErrnoException).code === "ENOENT" ? `runner not found: ${claudeBin()}` : (err as Error).message;
  } finally {
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
    await new Promise<void>((done) => log.end(done));
  }

  // Settle the run: the agent may already have reported done/silent.
  let final = getRun(db, run.id);
  const output = typeof result?.result === "string" ? result.result.trim() || null : null;
  const usage = {
    cost_usd: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null,
    turns: typeof result?.num_turns === "number" ? result.num_turns : null,
    session_id: result?.session_id ?? null,
    finished_at: now(),
  };
  if (error) {
    final = updateRun(db, run.id, { ...usage, status: "failed", error });
  } else if (final.status === "running") {
    final = updateRun(db, run.id, { ...usage, status: "done", summary: output?.slice(0, 1000) ?? null });
  } else {
    final = updateRun(db, run.id, usage);
  }

  // Settle the task, unless the agent already moved it somewhere else.
  if (task && previousStatus) {
    const current = getTask(db, task.id);
    if (current.status === "doing") {
      if (final.status === "failed") {
        const back = opts.failStatus ?? previousStatus;
        updateTask(db, task.id, { status: back });
        const note = back === previousStatus ? "" : ` Moved to ${back}; move it to To do to retry.`;
        addComment(db, task.id, "devit", `Run #${run.id} (${persona.name}) failed: ${final.error}.${note}`);
      } else if (final.status === "silent") {
        updateTask(db, task.id, { status: previousStatus });
      } else {
        updateTask(db, task.id, { status: "review" });
      }
    }
  }
  return { ...final, output };
}
