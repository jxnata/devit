import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DevitError } from "./errors.ts";
import { devitHome, PROJECT_DIR } from "./paths.ts";

export const PERMISSION_MODES = ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
/** Words taken by `devit run <subcommand>`, so no persona can use them. */
const RESERVED = new Set(["done", "silent", "list", "show"]);
const NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;

export interface Persona {
  name: string;
  role: string;
  lead: boolean;
  runner: "claude";
  model: string | null;
  effort: (typeof EFFORTS)[number] | null;
  /** Picks up tasks moved to `todo` and assigned to it while `devit serve` runs. */
  autopickup: boolean;
  allowed_tools: string[];
  disallowed_tools: string[];
  permission_mode: (typeof PERMISSION_MODES)[number] | null;
  /** MCP config files, relative to the persona file or absolute. */
  mcp_config: string[];
  max_budget_usd: number | null;
  timeout_minutes: number;
  /** The instructions: the markdown body. */
  instructions: string;
  /** Where it was loaded from. */
  file: string;
  scope: "global" | "project";
}

export function assertPersonaName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new DevitError(`invalid persona name "${name}"`, "use lowercase letters, digits and dashes, starting with a letter");
  }
  if (RESERVED.has(name)) throw new DevitError(`"${name}" is reserved; pick another persona name`);
}

export function globalPersonaDir(): string {
  return join(devitHome(), "personas");
}

export function projectPersonaDir(projectPath: string): string {
  return join(projectPath, PROJECT_DIR, "personas");
}

/** Splits `---\nyaml\n---\nbody`. A file without frontmatter is all body. */
export function splitFrontmatter(text: string, file: string): { data: Record<string, unknown>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text.trim() };
  let data: unknown;
  try {
    data = Bun.YAML.parse(m[1]!) ?? {};
  } catch (err) {
    throw new DevitError(`bad frontmatter in ${file}: ${(err as Error).message}`);
  }
  if (typeof data !== "object" || Array.isArray(data)) throw new DevitError(`frontmatter in ${file} must be a mapping`);
  return { data: data as Record<string, unknown>, body: m[2]!.trim() };
}

function list(value: unknown, field: string, file: string): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value;
  throw new DevitError(`${field} in ${file} must be a string or a list of strings`);
}

function oneOf<T extends string>(value: unknown, options: readonly T[], field: string, file: string): T | null {
  if (value == null) return null;
  if (!options.includes(value as T)) throw new DevitError(`${field} in ${file} must be one of: ${options.join(", ")}`);
  return value as T;
}

function positive(value: unknown, field: string, file: string): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new DevitError(`${field} in ${file} must be a positive number`);
  return n;
}

export function parsePersona(text: string, name: string, file: string, scope: Persona["scope"]): Persona {
  const { data, body } = splitFrontmatter(text, file);
  if (data.runner != null && data.runner !== "claude") {
    throw new DevitError(`runner "${String(data.runner)}" in ${file} is not supported yet; use claude`);
  }
  return {
    name,
    role: String(data.role ?? name),
    lead: data.lead === true,
    runner: "claude",
    model: data.model == null ? null : String(data.model),
    effort: oneOf(data.effort, EFFORTS, "effort", file),
    autopickup: data.autopickup === true,
    allowed_tools: list(data.allowed_tools, "allowed_tools", file),
    disallowed_tools: list(data.disallowed_tools, "disallowed_tools", file),
    permission_mode: oneOf(data.permission_mode, PERMISSION_MODES, "permission_mode", file),
    mcp_config: list(data.mcp_config, "mcp_config", file),
    max_budget_usd: positive(data.max_budget_usd, "max_budget_usd", file),
    timeout_minutes: positive(data.timeout_minutes, "timeout_minutes", file) ?? 30,
    instructions: body,
    file,
    scope,
  };
}

function readDir(dir: string, scope: Persona["scope"]): Map<string, Persona> {
  const found = new Map<string, Persona>();
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".md")) continue;
    const name = entry.slice(0, -3);
    if (!NAME_RE.test(name) || RESERVED.has(name)) continue;
    const file = join(dir, entry);
    found.set(name, parsePersona(readFileSync(file, "utf8"), name, file, scope));
  }
  return found;
}

/** Global personas, with the project's own files replacing any of the same name. */
export function listPersonas(projectPath?: string): Persona[] {
  const all = readDir(globalPersonaDir(), "global");
  if (projectPath) for (const [name, p] of readDir(projectPersonaDir(projectPath), "project")) all.set(name, p);
  return [...all.values()].sort((a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name));
}

export function getPersona(name: string, projectPath?: string): Persona {
  const persona = listPersonas(projectPath).find((p) => p.name === name);
  if (!persona) throw new DevitError(`no persona "${name}"`, "see `devit persona list`, or create it with `devit persona add`");
  return persona;
}

export function leadPersona(projectPath?: string): Persona | null {
  return listPersonas(projectPath).find((p) => p.lead) ?? null;
}

export interface NewPersona {
  name: string;
  role?: string;
  model?: string;
  lead?: boolean;
  instructions?: string;
}

export function personaTemplate(input: NewPersona): string {
  const role = input.role ?? input.name;
  return `---
role: ${JSON.stringify(role)}
lead: ${input.lead ? "true" : "false"}
model: ${input.model ?? "sonnet"}
# effort: medium              # low, medium, high, xhigh, max
autopickup: false             # true: works on tasks moved to todo and assigned to it
# Tools the agent may use without asking. Runs are headless: anything not allowed here is denied.
allowed_tools:
  - "Bash(devit:*)"
  - Read
  - Grep
  - Glob
# disallowed_tools: []
# permission_mode: acceptEdits  # acceptEdits, auto, bypassPermissions, dontAsk, plan
# mcp_config: [mcp.json]        # relative to this file
# max_budget_usd: 2
timeout_minutes: 30
---
${input.instructions ?? `You are the ${role} of this project.

Describe here what you are responsible for, how you work and what you must never do.`}
`;
}

export function addPersona(input: NewPersona, dir: string): string {
  assertPersonaName(input.name);
  const file = join(dir, `${input.name}.md`);
  if (existsSync(file)) throw new DevitError(`persona "${input.name}" already exists at ${file}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, personaTemplate(input));
  return file;
}

export function removePersona(name: string, dir: string): string {
  const file = join(dir, `${name}.md`);
  if (!existsSync(file)) throw new DevitError(`no persona file ${file}`);
  rmSync(file);
  return file;
}
