import { DevitError } from "../core/errors.ts";
import { example, PERSONA_EXAMPLES } from "../core/examples.ts";
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

--from copies a ready-made persona (see \`devit persona examples\`); --role, --model and --lead
override its settings.

Examples:
  devit persona add dev --role "Developer" --model opus
  devit persona add dev --from dev
  devit persona add boss --from lead`,
    options: {
      role: { type: "string", value: "text", description: "one-line role, e.g. \"Developer\"" },
      model: { type: "string", value: "model", description: "model alias or id (default: sonnet)" },
      lead: { type: "boolean", description: "make it the lead persona, which answers `devit ask`" },
      instructions: { type: "string", short: "i", value: "text", description: "the persona's instructions (default: a placeholder)" },
      from: { type: "string", value: "example", description: "start from an example: lead, dev, pm, writer, reviewer" },
      ...localOption,
    },
    run(ctx) {
      const name = ctx.positionals[0];
      if (!name) throw new DevitError("a persona needs a name", "devit persona add <name> --role \"...\"");
      const currentLead = listPersonas(ctx.maybeProject()?.path).find((p) => p.lead);
      if (ctx.values.lead && currentLead) {
        throw new DevitError(`"${currentLead.name}" is already the lead`, `set lead: false in ${currentLead.file} first`);
      }
      const from = str(ctx.values.from);
      let text: string | undefined;
      let note = "";
      if (from) {
        text = example("persona", from);
        const set = (key: string, value: string) => {
          text = text!.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`);
        };
        if (str(ctx.values.role)) set("role", JSON.stringify(str(ctx.values.role)));
        if (str(ctx.values.model)) set("model", str(ctx.values.model)!);
        if (ctx.values.lead) set("lead", "true");
        else if (currentLead && /^lead: true$/m.test(text)) {
          set("lead", "false");
          note = `\n"${currentLead.name}" is already the lead, so this one is not.`;
        }
        if (str(ctx.values.instructions)) text = text.replace(/\n---\n[\s\S]*$/, `\n---\n${str(ctx.values.instructions)}\n`);
      }
      const file = addPersona(
        {
          name,
          role: str(ctx.values.role),
          model: str(ctx.values.model),
          lead: Boolean(ctx.values.lead),
          instructions: str(ctx.values.instructions),
          text,
        },
        targetDir(ctx),
      );
      ctx.emit({ name, file, from: from ?? null }, () =>
        `Created persona "${name}"${from ? ` from the ${from} example` : ""} at ${file}${note}\nEdit it to set its tools and instructions.`,
      );
    },
  },
  {
    path: ["persona", "examples"],
    summary: "List the ready-made personas you can start from",
    run(ctx) {
      const rows = Object.entries(PERSONA_EXAMPLES).map(([name, text]) => ({
        name,
        role: text.match(/^role:\s*"?(.*?)"?$/m)?.[1] ?? name,
        autopickup: /^autopickup: true$/m.test(text),
        lead: /^lead: true$/m.test(text),
      }));
      ctx.emit(rows, () =>
        `${table(rows.map((r) => [r.name + (r.lead ? " *" : ""), r.role, r.autopickup ? "autopickup" : ""]), ["EXAMPLE", "ROLE", ""])}\n\nUse one: devit persona add <name> --from <example>`,
      );
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
