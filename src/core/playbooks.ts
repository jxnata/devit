import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DevitError } from "./errors.ts";
import { devitHome, PROJECT_DIR } from "./paths.ts";
import type { Project } from "./projects.ts";

/** Playbooks are markdown steps: the project's `.devit/playbooks/` first, then `~/.devit/playbooks/`. */
export interface Playbook {
  name: string;
  scope: "project" | "global";
  file: string;
  /** First non-empty line. */
  summary: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function globalPlaybookDir(): string {
  return join(devitHome(), "playbooks");
}

export function projectPlaybookDir(project: Project): string {
  return join(project.path, PROJECT_DIR, "playbooks");
}

function read(dir: string, scope: Playbook["scope"]): Playbook[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const file = join(dir, f);
      const first = readFileSync(file, "utf8").split("\n").find((l) => l.trim()) ?? "";
      return { name: f.slice(0, -3), scope, file, summary: first.replace(/^#+\s*/, "").slice(0, 120) };
    });
}

/** Project playbooks shadow global ones with the same name. */
export function listPlaybooks(project: Project | null): Playbook[] {
  const local = project ? read(projectPlaybookDir(project), "project") : [];
  const names = new Set(local.map((p) => p.name));
  return [...local, ...read(globalPlaybookDir(), "global").filter((p) => !names.has(p.name))];
}

export const PLAYBOOK_TEMPLATE = `What this playbook is for, in one line.

1. Collect: the commands or tools to gather what you need (devit task list --json, git log, gh, an MCP…).
2. Decide: what counts as new or worth reporting. If nothing is, end with \`devit run silent\`.
3. Act: create or update tasks, comment, open a PR. Leave anything public for the human, in Review.
4. Finish with \`devit run done --summary "<one line>"\`.
`;

export function addPlaybook(dir: string, name: string, text: string): string {
  if (!NAME_RE.test(name)) throw new DevitError(`invalid playbook name "${name}"`, "use a kebab-case slug, e.g. weekly-report");
  const file = join(dir, `${name}.md`);
  if (existsSync(file)) throw new DevitError(`playbook "${name}" already exists at ${file}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, text);
  return file;
}
