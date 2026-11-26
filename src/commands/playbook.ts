import { readFileSync } from "node:fs";
import { DevitError } from "../core/errors.ts";
import { example, PLAYBOOK_EXAMPLES } from "../core/examples.ts";
import { addPlaybook, globalPlaybookDir, listPlaybooks, PLAYBOOK_TEMPLATE, projectPlaybookDir } from "../core/playbooks.ts";
import { playbookPath } from "../core/runner.ts";
import { type Command, str, table } from "../framework.ts";

export const playbookCommands: Command[] = [
  {
    path: ["playbook", "list"],
    summary: "List playbooks (the project's, then global ones)",
    run(ctx) {
      const playbooks = listPlaybooks(ctx.maybeProject());
      ctx.emit(playbooks, () =>
        playbooks.length === 0
          ? "No playbooks yet. Add one with `devit playbook add <name>` (see `devit playbook examples`)."
          : table(playbooks.map((p) => [p.name, p.scope, p.summary]), ["PLAYBOOK", "SCOPE", "WHAT"]),
      );
    },
  },
  {
    path: ["playbook", "show"],
    summary: "Print a playbook",
    args: "<name>",
    run(ctx) {
      const name = ctx.positionals[0];
      if (!name) throw new DevitError("which playbook?", "devit playbook show <name>");
      const file = playbookPath(name, ctx.maybeProject());
      const text = readFileSync(file, "utf8");
      ctx.emit({ name, file, text }, () => `# ${file}\n\n${text.trimEnd()}`);
    },
  },
  {
    path: ["playbook", "examples"],
    summary: "List the ready-made playbooks you can start from",
    run(ctx) {
      const rows = Object.entries(PLAYBOOK_EXAMPLES).map(([name, text]) => ({ name, summary: text.split("\n")[0]! }));
      ctx.emit(rows, () => `${table(rows.map((r) => [r.name, r.summary]), ["EXAMPLE", "WHAT"])}\n\nUse one: devit playbook add <name> --from <example>`);
    },
  },
  {
    path: ["playbook", "add"],
    summary: "Create a playbook from a template or an example",
    args: "<name>",
    details: `
Writes .devit/playbooks/<name>.md in the current project (commit it), or ~/.devit/playbooks/ with
--global. Then edit it, and use it with \`devit run <persona> --playbook <name>\` or a routine.

Examples:
  devit playbook add weekly-report --from weekly-report
  devit playbook add release-notes`,
    options: {
      from: { type: "string", value: "example", description: "start from an example (see `devit playbook examples`)" },
      global: { type: "boolean", description: "for every project, in ~/.devit/playbooks/" },
    },
    run(ctx) {
      const name = ctx.positionals[0];
      if (!name) throw new DevitError("a playbook needs a name", "devit playbook add <name> [--from <example>]");
      const from = str(ctx.values.from);
      const text = from ? example("playbook", from) : PLAYBOOK_TEMPLATE;
      const dir = ctx.values.global ? globalPlaybookDir() : projectPlaybookDir(ctx.project());
      const file = addPlaybook(dir, name, text);
      ctx.emit({ name, file, from: from ?? null }, () => `Created ${file}${from ? ` from the ${from} example` : ""}. Edit it to fit the project.`);
    },
  },
];
