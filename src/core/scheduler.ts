import { usd } from "./format.ts";
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { DevitError } from "./errors.ts";
import { getPersona, type Persona } from "./personas.ts";
import { listProjects, type Project } from "./projects.ts";
import { claimRoutine, dueRoutines, recordRoutineRun, type Routine } from "./routines.ts";
import { executeRun, type ExecuteOptions, type RunResult } from "./runner.ts";
import { listTasks } from "./tasks.ts";

export interface SchedulerOptions {
  db: Database;
  /** Runs at the same time, across personas. A persona never runs twice at once. */
  maxParallel?: number;
  log?: (line: string) => void;
}

/**
 * The daemon's brain. Each tick starts what is due: routines whose time came (missed ones
 * run once), then `todo` tasks assigned to personas with autopickup. Runs are not awaited
 * by the tick; `idle()` waits for them.
 */
export class Scheduler {
  private readonly db: Database;
  private readonly maxParallel: number;
  private readonly log: (line: string) => void;
  private readonly busy = new Map<string, Promise<RunResult | null>>();
  private readonly abort = new AbortController();

  constructor(opts: SchedulerOptions) {
    this.db = opts.db;
    this.maxParallel = Math.max(1, opts.maxParallel ?? 3);
    this.log = opts.log ?? (() => {});
  }

  /** Personas running right now. */
  get running(): string[] {
    return [...this.busy.keys()];
  }

  private hasRoom(persona: string): boolean {
    return !this.busy.has(persona) && this.busy.size < this.maxParallel;
  }

  /** Starts due work; returns how many runs it started. */
  tick(at: Date = new Date()): number {
    if (this.abort.signal.aborted) return 0;
    let started = 0;
    for (const routine of dueRoutines(this.db, at)) {
      if (!this.hasRoom(routine.persona)) continue; // stays due; a later tick picks it up
      if (!claimRoutine(this.db, routine, at)) continue;
      if (this.startRoutine(routine)) started++;
    }
    for (const project of listProjects(this.db)) {
      if (!existsSync(project.path)) continue;
      for (const task of listTasks(this.db, { projectId: project.id, statuses: ["todo"] })) {
        if (!task.persona || !this.hasRoom(task.persona)) continue;
        const persona = this.persona(task.persona, project, `task #${task.id}`);
        if (!persona?.autopickup) continue;
        // A failure sends the task to the backlog, so a broken task is not retried forever.
        this.start(persona.name, `task #${task.id} (${project.slug})`, {
          project,
          persona,
          task,
          trigger: "task",
          failStatus: "backlog",
        });
        started++;
      }
    }
    return started;
  }

  private startRoutine(routine: Routine): boolean {
    let project: Project | null = null;
    if (routine.project_id !== null) {
      project = listProjects(this.db).find((p) => p.id === routine.project_id) ?? null;
      if (!project || !existsSync(project.path)) {
        this.log(`routine ${routine.name}: skipped, project folder ${routine.project_path ?? "?"} is missing`);
        return false;
      }
    }
    const persona = this.persona(routine.persona, project, `routine ${routine.name}`);
    if (!persona) return false;
    this.start(persona.name, `routine ${routine.name}`, {
      project,
      persona,
      playbook: routine.playbook,
      prompt: routine.prompt,
      routineId: routine.id,
      trigger: "routine",
      onStart: (run) => recordRoutineRun(this.db, routine.id, run.id),
    });
    return true;
  }

  private persona(name: string, project: Project | null, what: string): Persona | null {
    try {
      return getPersona(name, project?.path);
    } catch (err) {
      this.log(`${what}: skipped, ${(err as Error).message}`);
      return null;
    }
  }

  private start(persona: string, what: string, job: Omit<ExecuteOptions, "db" | "signal">): void {
    const promise = executeRun({
      ...job,
      db: this.db,
      signal: this.abort.signal,
      onStart: (run) => {
        job.onStart?.(run);
        this.log(`run #${run.id}: ${persona} on ${what}`);
      },
    })
      .then((run) => {
        const cost = run.cost_usd == null ? "" : ` (${usd(run.cost_usd)})`;
        const note = (run.error ?? run.summary ?? "").split("\n")[0]!.slice(0, 120);
        this.log(`run #${run.id}: ${run.status}${cost}${note ? `: ${note}` : ""}`);
        return run;
      })
      .catch((err) => {
        this.log(`${persona} on ${what}: ${err instanceof DevitError ? err.message : String(err)}`);
        return null;
      })
      .finally(() => this.busy.delete(persona));
    this.busy.set(persona, promise);
  }

  /** Resolves when every started run has ended. */
  async idle(): Promise<void> {
    while (this.busy.size) await Promise.all(this.busy.values());
  }

  /** Stops starting work and interrupts running agents. */
  async stop(): Promise<void> {
    this.abort.abort();
    await this.idle();
  }
}
