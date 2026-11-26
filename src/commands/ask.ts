import { DevitError } from "../core/errors.ts";
import { getPersona, leadPersona } from "../core/personas.ts";
import { executeRun } from "../core/runner.ts";
import { listRuns } from "../core/runs.ts";
import { type Command, str } from "../framework.ts";

export const askCommand: Command = {
  path: ["ask"],
  summary: "Talk to the lead persona: ask, plan or delegate work",
  args: "<message>",
  details: `
Runs the lead persona on your message, in the current project (or across projects outside one),
and prints its answer. The lead can read the board and memory and create tasks for the others.
--continue picks up the last conversation in this project.

Examples:
  devit ask "What is in review and what is blocked?"
  devit ask "Plan the checkout redesign and split it into tasks for dev and writer"
  devit ask --continue "Make the second task high priority"`,
  options: {
    continue: { type: "boolean", short: "c", description: "continue the last conversation with the lead here" },
    persona: { type: "string", value: "name", description: "talk to another persona instead of the lead" },
    quiet: { type: "boolean", short: "q", description: "print only the answer" },
  },
  async run(ctx) {
    const message = ctx.positionals.join(" ").trim();
    if (!message) throw new DevitError("what do you want to ask?", 'devit ask "..."');
    const db = ctx.db();
    const project = ctx.maybeProject();
    const name = str(ctx.values.persona);
    const persona = name ? getPersona(name, project?.path) : leadPersona(project?.path);
    if (!persona) {
      throw new DevitError("there is no lead persona", 'add one: devit persona add lead --role "Team lead" --lead');
    }

    let resume: string | null = null;
    if (ctx.values.continue) {
      const last = listRuns(db, { persona: persona.name, limit: 50 }).find(
        (r) => r.trigger === "ask" && r.session_id && r.project_id === (project?.id ?? null),
      );
      if (!last) throw new DevitError(`no earlier conversation with ${persona.name} here`, "drop --continue to start one");
      resume = last.session_id;
    }

    const progress = !ctx.json && !ctx.values.quiet;
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once("SIGINT", interrupt);
    const run = await executeRun({
      db,
      project,
      persona,
      prompt: message,
      resume,
      trigger: "ask",
      signal: controller.signal,
      onEvent: progress
        ? (text) => {
            for (const line of text.split("\n")) if (line.startsWith("→ ")) ctx.out(`  ${line}`);
          }
        : undefined,
    });
    process.off("SIGINT", interrupt);
    ctx.emit(run, () =>
      run.status === "failed"
        ? `${persona.name} failed: ${run.error}`
        : `${progress ? "\n" : ""}${run.output ?? run.summary ?? "(no answer)"}`,
    );
    if (run.status === "failed") process.exitCode = 1;
  },
};
