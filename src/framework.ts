import type { Database } from "bun:sqlite";
import { parseArgs } from "node:util";
import { openDb } from "./core/db.ts";
import { DevitError } from "./core/errors.ts";
import { type Project, resolveProject } from "./core/projects.ts";

export interface OptionSpec {
  type: "string" | "boolean";
  short?: string;
  multiple?: boolean;
  /** Shown in help next to the flag, e.g. `--persona <name>`. */
  value?: string;
  description: string;
}

export interface Command {
  /** Words that select the command, e.g. ["task", "add"]. */
  path: string[];
  summary: string;
  /** Positional arguments for the usage line, e.g. "<id> <status>". */
  args?: string;
  /** Longer help: examples, notes. */
  details?: string;
  options?: Record<string, OptionSpec>;
  run(ctx: Context): void | Promise<void>;
}

export interface Context {
  positionals: string[];
  values: Record<string, string | boolean | string[] | undefined>;
  json: boolean;
  db(): Database;
  /** The project from `-p` or the current directory; throws if there is none. */
  project(): Project;
  /** Same, but null when there is none and no `-p` was given. */
  maybeProject(): Project | null;
  /** Who is acting: the persona running this command (DEVIT_PERSONA), else "user". */
  actor: string;
  out(text: string): void;
  emit(data: unknown, human: () => string): void;
}

export const GLOBAL_OPTIONS: Record<string, OptionSpec> = {
  project: { type: "string", short: "p", value: "slug", description: "project to act on (default: the .devit/ above the current directory)" },
  json: { type: "boolean", description: "print JSON instead of text" },
  help: { type: "boolean", short: "h", description: "show help" },
};

export function findCommand(commands: Command[], argv: string[]): { command: Command; rest: string[] } | null {
  let best: Command | null = null;
  for (const command of commands) {
    const matches = command.path.every((word, i) => argv[i] === word);
    if (matches && (!best || command.path.length > best.path.length)) best = command;
  }
  return best ? { command: best, rest: argv.slice(best.path.length) } : null;
}

export async function runCommand(command: Command, argv: string[]): Promise<void> {
  const options = { ...GLOBAL_OPTIONS, ...command.options };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: Object.fromEntries(
        Object.entries(options).map(([name, o]) => [
          name,
          { type: o.type, multiple: o.multiple ?? false, ...(o.short ? { short: o.short } : {}) },
        ]),
      ),
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    throw new DevitError((err as Error).message.replace(/\. To specify a positional.*$/s, ""), `see \`devit ${command.path.join(" ")} --help\``);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(commandHelp(command));
    return;
  }

  let db: Database | null = null;
  const getDb = () => (db ??= openDb());
  let project: Project | null | undefined;
  const maybeProject = () => {
    if (project === undefined) project = resolveProject(getDb(), values.project as string | undefined);
    return project;
  };
  const json = Boolean(values.json);
  const ctx: Context = {
    positionals,
    values: values as Context["values"],
    json,
    db: getDb,
    maybeProject,
    project() {
      const p = maybeProject();
      if (!p) throw new DevitError("not inside a Devit project", "run `devit init` in the repo, or pass -p <slug>");
      return p;
    },
    actor: process.env.DEVIT_PERSONA || "user",
    out: (text) => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`),
    emit(data, human) {
      ctx.out(json ? JSON.stringify(data) : human());
    },
  };
  try {
    await command.run(ctx);
  } finally {
    (db as Database | null)?.close();
  }
}

// ---------- help ----------

function flagLabel(name: string, o: OptionSpec): string {
  const short = o.short ? `-${o.short}, ` : "    ";
  const value = o.type === "string" ? ` <${o.value ?? "value"}>` : "";
  return `${short}--${name}${value}`;
}

function optionLines(options: Record<string, OptionSpec>): string {
  const entries = Object.entries(options);
  const width = Math.max(...entries.map(([n, o]) => flagLabel(n, o).length));
  return entries.map(([n, o]) => `  ${flagLabel(n, o).padEnd(width)}  ${o.description}`).join("\n");
}

export function commandHelp(command: Command): string {
  const usage = `devit ${command.path.join(" ")}${command.args ? ` ${command.args}` : ""} [options]`;
  const parts = [`${command.summary}\n`, `Usage: ${usage}\n`];
  if (command.details) parts.push(`${command.details.trim()}\n`);
  if (command.options && Object.keys(command.options).length) {
    parts.push(`Options:\n${optionLines(command.options)}\n`);
  }
  parts.push(`Global options:\n${optionLines(GLOBAL_OPTIONS)}\n`);
  return parts.join("\n");
}

export function mainHelp(commands: Command[], version: string): string {
  const rows = commands.map((c) => [`${c.path.join(" ")}${c.args ? ` ${c.args}` : ""}`, c.summary] as const);
  const width = Math.max(...rows.map(([u]) => u.length));
  return [
    `devit ${version}: a small team of AI agents for your projects\n`,
    "Usage: devit <command> [options]\n",
    "Commands:",
    ...rows.map(([u, s]) => `  ${u.padEnd(width)}  ${s}`),
    "",
    "Run `devit <command> --help` for details. Docs: https://github.com/jxnata/devit/tree/master/docs",
    "",
  ].join("\n");
}

// ---------- output helpers ----------

export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  if (all.length === 0) return "";
  const widths = all[0]!.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) =>
    r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ").trimEnd();
  return all.map(line).join("\n");
}

export function str(value: string | boolean | string[] | undefined): string | undefined {
  if (value === undefined || typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(" ");
  return undefined;
}
