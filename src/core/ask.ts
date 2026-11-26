import type { Database } from "bun:sqlite";
import { DevitError } from "./errors.ts";
import { getPersona, leadPersona } from "./personas.ts";
import type { Project } from "./projects.ts";
import { executeRun, type RunResult } from "./runner.ts";
import type { Run } from "./runs.ts";
import { listRuns } from "./runs.ts";

export interface AskOptions {
  db: Database;
  project: Project | null;
  message: string;
  /** Another persona instead of the lead. */
  persona?: string | null;
  /** Resume the last `ask` conversation with this persona, in the same project. */
  continue?: boolean;
  signal?: AbortSignal;
  onStart?: (run: Run) => void;
  onEvent?: (line: string) => void;
}

/** `devit ask`, from the CLI or the board: runs the lead (or a persona) on a message. */
export function ask(opts: AskOptions): Promise<RunResult> {
  const { db, project } = opts;
  const message = opts.message.trim();
  if (!message) throw new DevitError("what do you want to ask?", 'devit ask "..."');
  const persona = opts.persona ? getPersona(opts.persona, project?.path) : leadPersona(project?.path);
  if (!persona) {
    throw new DevitError("there is no lead persona", 'add one: devit persona add lead --role "Team lead" --lead');
  }
  let resume: string | null = null;
  if (opts.continue) {
    const last = listRuns(db, { persona: persona.name, limit: 50 }).find(
      (r) => r.trigger === "ask" && r.session_id && r.project_id === (project?.id ?? null),
    );
    if (!last) throw new DevitError(`no earlier conversation with ${persona.name} here`, "drop --continue to start one");
    resume = last.session_id;
  }
  return executeRun({
    db,
    project,
    persona,
    prompt: message,
    resume,
    trigger: "ask",
    signal: opts.signal,
    onStart: opts.onStart,
    onEvent: opts.onEvent,
  });
}
