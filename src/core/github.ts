import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { DevitError } from "./errors.ts";
import { projectFile } from "./paths.ts";
import { type Project, readProjectConfig } from "./projects.ts";
import { addComment, addTask, listTasks, type Task, updateTask } from "./tasks.ts";

/**
 * GitHub sync through the `gh` CLI (its auth, no tokens in Devit). Read-mostly:
 * - open issues with the project's label (default `devit`) become backlog tasks;
 * - a task whose PR was merged, or whose issue was closed, moves to done.
 * Devit never closes, comments on or labels anything on GitHub.
 */

export const DEFAULT_ISSUE_LABEL = "devit";

export function ghBin(): string {
  return process.env.DEVIT_GH_BIN || "gh";
}

function gh<T>(args: string[], cwd?: string): T {
  let res;
  try {
    res = Bun.spawnSync([ghBin(), ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new DevitError(`GitHub CLI not found: ${ghBin()}`, "install it from https://cli.github.com and run `gh auth login`");
  }
  if (res.exitCode !== 0) {
    const err = res.stderr.toString().trim().split("\n").pop() || `exit ${res.exitCode}`;
    throw new DevitError(`gh ${args.slice(0, 2).join(" ")} failed: ${err}`);
  }
  return JSON.parse(res.stdout.toString() || "null") as T;
}

/** Whether `gh` is installed and logged in. */
export function ghReady(): boolean {
  try {
    return Bun.spawnSync([ghBin(), "auth", "status"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  } catch {
    return false;
  }
}

export function issueLabel(project: Project): string {
  if (!existsSync(projectFile(project.path))) return DEFAULT_ISSUE_LABEL;
  return readProjectConfig(project.path).issue_label ?? DEFAULT_ISSUE_LABEL;
}

export interface SyncResult {
  project: string;
  imported: Task[];
  done: Task[];
  skipped?: string;
}

interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
}

export function syncProject(db: Database, project: Project): SyncResult {
  const result: SyncResult = { project: project.slug, imported: [], done: [] };
  if (!project.repo) return { ...result, skipped: "no GitHub repo in .devit/project.yaml" };
  const label = issueLabel(project);
  const tasks = listTasks(db, { projectId: project.id });
  const known = new Set(tasks.map((t) => t.issue_url).filter(Boolean));

  const issues = gh<Issue[]>([
    "issue", "list", "-R", project.repo, "--state", "open", "--label", label,
    "--json", "number,title,body,url", "--limit", "100",
  ]);
  for (const issue of issues.sort((a, b) => a.number - b.number)) {
    if (known.has(issue.url)) continue;
    const task = addTask(db, {
      projectId: project.id,
      title: issue.title,
      body: (issue.body ?? "").trim().slice(0, 8000),
      source: "github",
      createdBy: "github",
    });
    result.imported.push(updateTask(db, task.id, { issue_url: issue.url }));
  }

  for (const task of tasks) {
    if (task.status === "done") continue;
    if (task.pr_url) {
      const pr = gh<{ state: string }>(["pr", "view", task.pr_url, "--json", "state"]);
      if (pr.state === "MERGED") {
        addComment(db, task.id, "github", `PR merged: ${task.pr_url}`);
        result.done.push(updateTask(db, task.id, { status: "done" }));
        continue;
      }
    }
    if (task.issue_url) {
      const issue = gh<{ state: string }>(["issue", "view", task.issue_url, "--json", "state"]);
      if (issue.state === "CLOSED") {
        addComment(db, task.id, "github", `Issue closed: ${task.issue_url}`);
        result.done.push(updateTask(db, task.id, { status: "done" }));
      }
    }
  }
  return result;
}
