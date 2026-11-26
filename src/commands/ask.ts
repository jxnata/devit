import { ask } from "../core/ask.ts";
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
    const progress = !ctx.json && !ctx.values.quiet;
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once("SIGINT", interrupt);
    const run = await ask({
      db: ctx.db(),
      project: ctx.maybeProject(),
      message: ctx.positionals.join(" "),
      persona: str(ctx.values.persona),
      continue: Boolean(ctx.values.continue),
      signal: controller.signal,
      onEvent: progress
        ? (text) => {
            for (const line of text.split("\n")) if (line.startsWith("→ ")) ctx.out(`  ${line}`);
          }
        : undefined,
    }).finally(() => process.off("SIGINT", interrupt));
    ctx.emit(run, () =>
      run.status === "failed"
        ? `${run.persona} failed: ${run.error}`
        : `${progress ? "\n" : ""}${run.output ?? run.summary ?? "(no answer)"}`,
    );
    if (run.status === "failed") process.exitCode = 1;
  },
};
