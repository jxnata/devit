import { DevitError } from "../core/errors.ts";
import {
  addPersona,
  getPersona,
  globalPersonaDir,
  listPersonas,
  projectPersonaDir,
  removePersona,
} from "../core/personas.ts";
import { type Command, type Context, str, table } from "../framework.ts";

function targetDir(ctx: Context): string {
  return ctx.values.local ? projectPersonaDir(ctx.project().path) : globalPersonaDir();
}

const localOption = {
  local: { type: "boolean" as const, description: "the current project's .devit/personas/ instead of the global folder" },
};

export const personaCommands: Command[] = [
  {
    path: ["persona", "list"],
    summary: "List personas (global, plus the current project's overrides)",
    run(ctx) {
      const personas = listPersonas(ctx.maybeProject()?.path);
      ctx.emit(
        personas.map(({ instructions, ...p }) => p),
        () =>
          personas.length === 0
            ? "No personas yet. Create one with `devit persona add <name> --role \"...\"`."
            : table(
                personas.map((p) => [
                  p.name + (p.lead ? " *" : ""),
                  p.role,
                  p.model ?? "default",
                  p.autopickup ? "autopickup" : "",
                  p.scope,
                ]),
                ["NAME", "ROLE", "MODEL", "", "SCOPE"],
              ) + (personas.some((p) => p.lead) ? "\n\n* lead persona" : ""),
      );
    },
  },
  {
    path: ["persona", "show"],
    summary: "Show a persona's settings and instructions",
    args: "<name>",
    run(ctx) {
      const name = ctx.positionals[0];
      if (!name) throw new DevitError("which persona?", "devit persona show <name>");
      const p = getPersona(name, ctx.maybeProject()?.path);
      ctx.emit(p, () =>
        [
          `${p.name}: ${p.role}${p.lead ? " (lead)" : ""}`,
          `  file:        ${p.file}`,
          `  model:       ${p.model ?? "default"}${p.effort ? `, effort ${p.effort}` : ""}`,
          `  autopickup:  ${p.autopickup ? "yes" : "no"}`,
          `  tools:       ${["Bash(devit:*)", ...p.allowed_tools.filter((t) => t !== "Bash(devit:*)")].join(", ")}`,
          ...(p.disallowed_tools.length ? [`  denied:      ${p.disallowed_tools.join(", ")}`] : []),
          ...(p.permission_mode ? [`  permissions: ${p.permission_mode}`] : []),
          ...(p.mcp_config.length ? [`  mcp:         ${p.mcp_config.join(", ")}`] : []),
          `  limits:      ${p.timeout_minutes} min${p.max_budget_usd ? `, US$ ${p.max_budget_usd}` : ""}`,
          "",
          p.instructions || "(no instructions)",
        ].join("\n"),
      );
    },
  },
  {
    path: ["persona", "add"],
    summary: "Create a persona file from a template",
    args: "<name>",
    details: `
Writes ~/.devit/personas/<name>.md (or .devit/personas/ in the project with --local).
Edit the file to set its tools, model and instructions; see docs/personas.md.

Example:
  devit persona add dev --role "Developer" --model opus`,
    options: {
      role: { type: "string", value: "text", description: "one-line role, e.g. \"Developer\"" },
      model: { type: "string", value: "model", description: "model alias or id (default: sonnet)" },
      lead: { type: "boolean", description: "make it the lead persona, which answers `devit ask`" },
      instructions: { type: "string", short: "i", value: "text", description: "the persona's instructions (default: a placeholder)" },
      ...localOption,
    },
    run(ctx) {
      const name = ctx.positionals[0];
      if (!name) throw new DevitError("a persona needs a name", "devit persona add <name> --role \"...\"");
      if (ctx.values.lead) {
        const lead = listPersonas(ctx.maybeProject()?.path).find((p) => p.lead);
        if (lead) throw new DevitError(`"${lead.name}" is already the lead`, `set lead: false in ${lead.file} first`);
      }
      const file = addPersona(
        {
          name,
          role: str(ctx.values.role),
          model: str(ctx.values.model),
          lead: Boolean(ctx.values.lead),
          instructions: str(ctx.values.instructions),
        },
        targetDir(ctx),
      );
      ctx.emit({ name, file }, () => `Created persona "${name}" at ${file}\nEdit it to set its tools and instructions.`);
    },
  },
  {
    path: ["persona", "remove"],
    summary: "Delete a persona file",
    args: "<name>",
    options: localOption,
    run(ctx) {
      const name = ctx.positionals[0];
      if (!name) throw new DevitError("which persona?", "devit persona remove <name>");
      const file = removePersona(name, targetDir(ctx));
      ctx.emit({ removed: name, file }, () => `Deleted ${file}`);
    },
  },
];
