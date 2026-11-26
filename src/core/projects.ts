import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { now } from "./db.ts";
import { DevitError } from "./errors.ts";
import { findProjectRoot, PROJECT_DIR, projectFile } from "./paths.ts";

export interface Project {
  id: number;
  slug: string;
  name: string;
  path: string;
  repo: string | null;
  base_branch: string;
  created_at: string;
}

/** What `.devit/project.yaml` holds. It is committed, so it never has a machine path. */
export interface ProjectConfig {
  slug: string;
  name: string;
  repo: string | null;
  base_branch: string;
  /** GitHub issues with this label become tasks (default "devit"). */
  issue_label?: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new DevitError(
      `invalid project slug "${slug}"`,
      "use lowercase letters, digits and dashes, starting with a letter or digit",
    );
  }
}

// ---------- project.yaml ----------

export function readProjectConfig(root: string): ProjectConfig {
  const file = projectFile(root);
  let data: unknown;
  try {
    data = Bun.YAML.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new DevitError(`could not read ${file}: ${(err as Error).message}`);
  }
  if (!data || typeof data !== "object") throw new DevitError(`${file} is empty or not a mapping`);
  const raw = data as Record<string, unknown>;
  const slug = String(raw.slug ?? "");
  assertSlug(slug);
  return {
    slug,
    name: String(raw.name ?? slug),
    repo: raw.repo == null || raw.repo === "" ? null : String(raw.repo),
    base_branch: String(raw.base_branch ?? "main"),
    ...(raw.issue_label ? { issue_label: String(raw.issue_label) } : {}),
  };
}

export function writeProjectConfig(root: string, config: ProjectConfig): void {
  mkdirSync(join(root, PROJECT_DIR, "playbooks"), { recursive: true });
  const keep = join(root, PROJECT_DIR, "playbooks", ".gitkeep");
  if (!existsSync(keep)) writeFileSync(keep, "");
  const lines = [
    "# Devit project config. Commit it so everyone working on this repo shares it.",
    `slug: ${config.slug}`,
    `name: ${JSON.stringify(config.name)}`,
    `repo: ${config.repo ?? "null"}`,
    `base_branch: ${config.base_branch}`,
    ...(config.issue_label ? [`issue_label: ${JSON.stringify(config.issue_label)}`] : []),
    "",
  ];
  writeFileSync(projectFile(root), lines.join("\n"));
}

// ---------- git detection ----------

function git(cwd: string, ...args: string[]): string | null {
  const res = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  if (res.exitCode !== 0) return null;
  const out = res.stdout.toString().trim();
  return out || null;
}

export function gitRoot(dir: string): string | null {
  return git(dir, "rev-parse", "--show-toplevel");
}

/** `owner/name` from a GitHub remote URL (https or ssh), or null. */
export function parseGithubRepo(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Prefers `develop` (PRs go there first), then the remote default, then the current branch. */
export function detectBaseBranch(root: string): string {
  const hasRef = (ref: string) =>
    Bun.spawnSync(["git", "show-ref", "--verify", "--quiet", ref], { cwd: root }).exitCode === 0;
  if (hasRef("refs/remotes/origin/develop") || hasRef("refs/heads/develop")) return "develop";
  const remoteHead = git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  if (remoteHead) return remoteHead.replace(/^origin\//, "");
  return git(root, "symbolic-ref", "--short", "HEAD") ?? "main";
}

export function detectConfig(root: string, overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  const name = overrides.name ?? basename(root);
  const slug = overrides.slug ?? slugify(name);
  assertSlug(slug);
  return {
    slug,
    name,
    repo: overrides.repo ?? parseGithubRepo(git(root, "remote", "get-url", "origin")),
    base_branch: overrides.base_branch ?? detectBaseBranch(root),
  };
}

// ---------- database ----------

export function listProjects(db: Database): Project[] {
  return db.query("SELECT * FROM projects ORDER BY slug").all() as Project[];
}

export function getProjectBySlug(db: Database, slug: string): Project | null {
  return (db.query("SELECT * FROM projects WHERE slug = $slug").get({ slug }) as Project) ?? null;
}

function getProjectByPath(db: Database, path: string): Project | null {
  return (db.query("SELECT * FROM projects WHERE path = $path").get({ path }) as Project) ?? null;
}

/**
 * Registers the project at `root` (or refreshes it). A slug already used by another
 * path is an error, unless that path no longer has the project (the repo moved).
 */
export function upsertProject(db: Database, root: string, config: ProjectConfig): Project {
  const path = resolve(root);
  const byPath = getProjectByPath(db, path);
  const bySlug = getProjectBySlug(db, config.slug);
  if (bySlug && bySlug.id !== byPath?.id) {
    if (existsSync(projectFile(bySlug.path))) {
      throw new DevitError(
        `slug "${config.slug}" is already used by ${bySlug.path}`,
        "pick another with --slug",
      );
    }
    // The repo moved: the old row points at a path that no longer has the project.
    if (byPath) db.query("DELETE FROM projects WHERE id = $id").run({ id: bySlug.id });
    else {
      db.query("UPDATE projects SET path = $path WHERE id = $id").run({ path, id: bySlug.id });
      return upsertProject(db, root, config);
    }
  }
  const params = { slug: config.slug, name: config.name, repo: config.repo, base_branch: config.base_branch, path };
  if (byPath) {
    db.query(
      `UPDATE projects SET slug = $slug, name = $name, repo = $repo, base_branch = $base_branch
       WHERE path = $path`,
    ).run(params);
  } else {
    db.query(
      `INSERT INTO projects (slug, name, path, repo, base_branch, created_at)
       VALUES ($slug, $name, $path, $repo, $base_branch, $created_at)`,
    ).run({ ...params, created_at: now() });
  }
  return getProjectBySlug(db, config.slug)!;
}

export function removeProject(db: Database, slug: string): void {
  const res = db.query("DELETE FROM projects WHERE slug = $slug").run({ slug });
  if (res.changes === 0) throw new DevitError(`no project "${slug}"`);
}

/**
 * The project a command acts on: `-p <slug>` if given, else the nearest `.devit/` above cwd.
 * A repo that has `.devit/project.yaml` but is not registered yet (a fresh clone) is registered.
 */
export function resolveProject(db: Database, slug?: string, cwd: string = process.cwd()): Project | null {
  if (slug) {
    const project = getProjectBySlug(db, slug);
    if (!project) throw new DevitError(`no project "${slug}"`, "see `devit project list`");
    return project;
  }
  const root = findProjectRoot(cwd);
  if (!root) return null;
  const existing = getProjectByPath(db, resolve(root));
  const config = readProjectConfig(root);
  const same =
    existing &&
    existing.slug === config.slug &&
    existing.name === config.name &&
    existing.repo === config.repo &&
    existing.base_branch === config.base_branch;
  if (same) return existing;
  return upsertProject(db, root, config);
}
