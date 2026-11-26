import { existsSync } from "node:fs";
import { type SyncResult, syncProject } from "../core/github.ts";
import { listProjects } from "../core/projects.ts";
import type { Command } from "../framework.ts";

function describe(r: SyncResult): string {
  if (r.skipped) return `${r.project}: skipped (${r.skipped})`;
  const lines = [`${r.project}: ${r.imported.length} imported, ${r.done.length} done`];
  for (const t of r.imported) lines.push(`  + #${t.id} ${t.title}`);
  for (const t of r.done) lines.push(`  ✓ #${t.id} ${t.title}`);
  return lines.join("\n");
}

export const githubCommands: Command[] = [
  {
    path: ["github", "sync"],
    summary: "Import labeled GitHub issues and close tasks whose PR merged",
    details: `
Uses the GitHub CLI (\`gh\`), logged in with \`gh auth login\`. For the project's repo:
  - open issues labeled \`devit\` (or \`issue_label\` in .devit/project.yaml) become backlog tasks
  - a task whose PR was merged, or whose issue was closed, moves to done
Devit only reads from GitHub. \`devit serve\` runs this every 15 minutes.`,
    options: { all: { type: "boolean", short: "a", description: "every project with a repo" } },
    run(ctx) {
      const db = ctx.db();
      const projects = ctx.values.all ? listProjects(db).filter((p) => p.repo && existsSync(p.path)) : [ctx.project()];
      const results = projects.map((p) => syncProject(db, p));
      ctx.emit(results, () => (results.length ? results.map(describe).join("\n") : "No projects with a GitHub repo."));
    },
  },
];
