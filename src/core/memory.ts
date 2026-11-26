import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { now } from "./db.ts";
import { DevitError } from "./errors.ts";
import { devitHome } from "./paths.ts";
import { splitFrontmatter } from "./personas.ts";

/**
 * Memory is markdown: one fact per file, in three scopes. Each scope keeps a generated
 * MEMORY.md index (name + one-line description) that goes into every run's prompt;
 * the agent reads full entries on demand with `devit memory show`.
 */
export const SCOPES = ["global", "project", "persona"] as const;
export type Scope = (typeof SCOPES)[number];

export interface ScopeRef {
  scope: Scope;
  /** Project slug for "project", persona name for "persona". */
  owner?: string;
}

export interface MemoryEntry {
  name: string;
  description: string;
  body: string;
  scope: Scope;
  owner: string | null;
  updated: string;
  author: string;
  file: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const INDEX = "MEMORY.md";

export function scopeLabel(ref: { scope: Scope; owner?: string | null }): string {
  return ref.scope === "global" ? "global" : `${ref.scope}:${ref.owner}`;
}

export function scopeDir(ref: ScopeRef): string {
  const root = join(devitHome(), "memory");
  if (ref.scope === "global") return join(root, "global");
  if (!ref.owner) throw new DevitError(`the ${ref.scope} scope needs a ${ref.scope === "project" ? "project" : "persona"}`);
  return join(root, ref.scope === "project" ? "projects" : "personas", ref.owner);
}

function assertName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new DevitError(`invalid memory name "${name}"`, "use a short kebab-case slug, e.g. release-process");
  }
}

function readEntry(file: string, ref: ScopeRef): MemoryEntry {
  const name = file.split("/").pop()!.slice(0, -3);
  const { data, body } = splitFrontmatter(readFileSync(file, "utf8"), file);
  return {
    name,
    description: String(data.description ?? body.split("\n")[0] ?? "").slice(0, 200),
    body,
    scope: ref.scope,
    owner: ref.owner ?? null,
    updated: String(data.updated ?? ""),
    author: String(data.author ?? "user"),
    file,
  };
}

export function listMemory(ref: ScopeRef): MemoryEntry[] {
  const dir = scopeDir(ref);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== INDEX)
    .sort()
    .map((f) => readEntry(join(dir, f), ref));
}

function writeIndex(ref: ScopeRef): void {
  const dir = scopeDir(ref);
  const entries = listMemory(ref);
  const lines = [`# Memory (${scopeLabel(ref)})`, "", ...entries.map((e) => `- ${e.name}: ${e.description}`), ""];
  writeFileSync(join(dir, INDEX), lines.join("\n"));
}

export interface NewMemory {
  name: string;
  description: string;
  body: string;
  author: string;
}

/** Creates or replaces an entry and refreshes the scope's index. */
export function saveMemory(ref: ScopeRef, input: NewMemory): MemoryEntry {
  assertName(input.name);
  const description = input.description.trim().replace(/\s+/g, " ");
  if (!description) throw new DevitError("a memory needs a one-line description");
  const dir = scopeDir(ref);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${input.name}.md`);
  const text = [
    "---",
    `description: ${JSON.stringify(description)}`,
    `updated: ${now()}`,
    `author: ${input.author}`,
    "---",
    input.body.trim(),
    "",
  ].join("\n");
  writeFileSync(file, text);
  writeIndex(ref);
  return readEntry(file, ref);
}

export function getMemory(ref: ScopeRef, name: string): MemoryEntry {
  assertName(name);
  const file = join(scopeDir(ref), `${name}.md`);
  if (!existsSync(file)) throw new DevitError(`no memory "${name}" in ${scopeLabel(ref)}`);
  return readEntry(file, ref);
}

export function removeMemory(ref: ScopeRef, name: string): void {
  const entry = getMemory(ref, name);
  rmSync(entry.file);
  writeIndex(ref);
}

/** Case-insensitive search over name, description and body, in the given scopes. */
export function searchMemory(refs: ScopeRef[], term: string): MemoryEntry[] {
  const needle = term.toLowerCase();
  return refs.flatMap((ref) =>
    listMemory(ref).filter((e) => `${e.name}\n${e.description}\n${e.body}`.toLowerCase().includes(needle)),
  );
}

/** The scopes visible from a context: global, then the project's, then the persona's. */
export function visibleScopes(project?: string | null, persona?: string | null): ScopeRef[] {
  const refs: ScopeRef[] = [{ scope: "global" }];
  if (project) refs.push({ scope: "project", owner: project });
  if (persona) refs.push({ scope: "persona", owner: persona });
  return refs;
}

/** Index lines for a prompt: what each scope knows, without the bodies. */
export function memoryIndex(refs: ScopeRef[]): string {
  const blocks = refs
    .map((ref) => {
      const entries = listMemory(ref);
      if (entries.length === 0) return null;
      return [`${scopeLabel(ref)}:`, ...entries.map((e) => `- ${e.name}: ${e.description}`)].join("\n");
    })
    .filter(Boolean);
  return blocks.length ? blocks.join("\n\n") : "(empty)";
}
