// Example personas and playbooks ship inside the binary (text imports), so `--from` works anywhere.
import dev from "../../examples/personas/dev.md" with { type: "text" };
import lead from "../../examples/personas/lead.md" with { type: "text" };
import pm from "../../examples/personas/pm.md" with { type: "text" };
import reviewer from "../../examples/personas/reviewer.md" with { type: "text" };
import writer from "../../examples/personas/writer.md" with { type: "text" };
import fridaySummary from "../../examples/playbooks/friday-summary.md" with { type: "text" };
import reviewQueue from "../../examples/playbooks/review-queue.md" with { type: "text" };
import sentryTriage from "../../examples/playbooks/sentry-triage.md" with { type: "text" };
import weeklyReport from "../../examples/playbooks/weekly-report.md" with { type: "text" };
import { DevitError } from "./errors.ts";

export const PERSONA_EXAMPLES: Record<string, string> = { lead, dev, pm, writer, reviewer };

export const PLAYBOOK_EXAMPLES: Record<string, string> = {
  "weekly-report": weeklyReport,
  "friday-summary": fridaySummary,
  "sentry-triage": sentryTriage,
  "review-queue": reviewQueue,
};

export function example(kind: "persona" | "playbook", name: string): string {
  const set = kind === "persona" ? PERSONA_EXAMPLES : PLAYBOOK_EXAMPLES;
  const text = set[name];
  if (text === undefined) {
    throw new DevitError(`no ${kind} example "${name}"`, `examples: ${Object.keys(set).join(", ")}`);
  }
  return text;
}
