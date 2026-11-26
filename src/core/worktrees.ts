import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DevitError } from "./errors.ts";
import { devitHome } from "./paths.ts";
import type { Project } from "./projects.ts";

/**
 * Runs of personas with `worktree: true` happen in a fresh git worktree, so the agent never
 * switches branches or leaves files in the human's checkout, and two personas can work on the
 * same repo at once.
 */

function git(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  const res = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, // never wait on a credential prompt
  });
  return { ok: res.exitCode === 0, out: (res.exitCode === 0 ? res.stdout : res.stderr).toString().trim() };
}

export function worktreePath(project: Project, runId: number): string {
  return join(devitHome(), "worktrees", project.slug, `run-${runId}`);
}

/** Creates a detached worktree at the tip of the base branch (origin's, freshly fetched, when there is one). */
export function createWorktree(project: Project, runId: number): { path: string; base: string } {
  const path = worktreePath(project, runId);
  mkdirSync(dirname(path), { recursive: true });
  const base = project.base_branch;
  const hasOrigin = git(project.path, "remote", "get-url", "origin").ok;
  if (hasOrigin) git(project.path, "fetch", "--quiet", "origin", base); // offline is fine: use what we have
  const ref = hasOrigin && git(project.path, "rev-parse", "--verify", "--quiet", `origin/${base}`).ok ? `origin/${base}` : base;
  const added = git(project.path, "worktree", "add", "--detach", path, ref);
  if (!added.ok) throw new DevitError(`could not create a worktree for ${project.slug} at ${ref}: ${added.out}`);
  return { path, base: ref };
}

/**
 * Removes the worktree when nothing would be lost (no uncommitted changes); the branches the
 * agent pushed or created stay in the repo. Returns a note when it had to keep it.
 */
export function cleanupWorktree(project: Project, path: string): string | null {
  if (!existsSync(path)) return null;
  const status = git(path, "status", "--porcelain");
  if (!status.ok) return null;
  if (status.out) return `left the worktree at ${path}: it has uncommitted changes`;
  const removed = git(project.path, "worktree", "remove", path);
  if (!removed.ok) return `could not remove the worktree at ${path}: ${removed.out}`;
  git(project.path, "worktree", "prune");
  return null;
}
