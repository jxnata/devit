import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DevitError } from "../core/errors.ts";
import { findProjectRoot, projectFile } from "../core/paths.ts";
import {
  detectConfig,
  getProjectBySlug,
  gitRoot,
  listProjects,
  readProjectConfig,
  removeProject,
  upsertProject,
  writeProjectConfig,
} from "../core/projects.ts";
import { listTasks, STATUSES } from "../core/tasks.ts";
import { type Command, str, table } from "../framework.ts";

export const projectCommands: Command[] = [
  {
    path: ["init"],
    summary: "Set up Devit in the current repo and register it",
    args: "[dir]",
    details: `
Creates .devit/project.yaml (commit it) and registers the project on this machine.
Slug, repo and base branch are detected from git; override them with the flags.
Running it again in an initialized repo re-registers it and changes nothing else.`,
    options: {
      slug: { type: "string", value: "slug", description: "project slug (default: from the folder name)" },
      name: { type: "string", value: "name", description: "display name (default: the folder name)" },
      base: { type: "string", value: "branch", description: "branch PRs target (default: develop if it exists, else the default branch)" },
      repo: { type: "string", value: "owner/name", description: "GitHub repo (default: from the origin remote)" },
    },
    run(ctx) {
      const start = resolve(ctx.positionals[0] ?? process.cwd());
      if (!existsSync(start)) throw new DevitError(`no such directory: ${start}`);
      const existing = findProjectRoot(start);
      const root = existing ?? gitRoot(start) ?? start;
      const db = ctx.db();
      let created = false;
      let config;
      if (existing) {
        config = readProjectConfig(existing);
      } else {
        config = detectConfig(root, {
          slug: str(ctx.values.slug),
          name: str(ctx.values.name),
          base_branch: str(ctx.values.base),
          repo: str(ctx.values.repo),
        });
      }
      const project = upsertProject(db, root, config);
      if (!existing) {
        writeProjectConfig(root, config);
        created = true;
      }
      ctx.emit({ created, project }, () =>
        [
          created ? `Initialized Devit project "${project.slug}" in ${root}` : `Project "${project.slug}" is already set up; registered ${root}`,
          `  repo:        ${project.repo ?? "(none)"}`,
          `  base branch: ${project.base_branch}`,
          created ? `\nCommit ${projectFile(root).replace(`${root}/`, "")}. Next: devit task add "First task"` : "",
        ].filter(Boolean).join("\n"),
      );
    },
  },
  {
    path: ["project", "list"],
    summary: "List registered projects",
    run(ctx) {
      const db = ctx.db();
      const projects = listProjects(db).map((p) => {
        const open = listTasks(db, { projectId: p.id, statuses: STATUSES.filter((s) => s !== "done") }).length;
        return { ...p, open_tasks: open, missing: !existsSync(projectFile(p.path)) };
      });
      ctx.emit(projects, () =>
        projects.length === 0
          ? "No projects yet. Run `devit init` inside a repo."
          : table(
              projects.map((p) => [p.slug, String(p.open_tasks), p.repo ?? "-", p.missing ? `${p.path} (missing)` : p.path]),
              ["SLUG", "OPEN", "REPO", "PATH"],
            ),
      );
    },
  },
  {
    path: ["project", "show"],
    summary: "Show a project and its task counts",
    args: "[slug]",
    run(ctx) {
      const slug = ctx.positionals[0];
      const project = slug ? getProjectBySlug(ctx.db(), slug) : ctx.project();
      if (!project) throw new DevitError(`no project "${slug}"`);
      const tasks = listTasks(ctx.db(), { projectId: project.id });
      const counts = Object.fromEntries(STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length]));
      ctx.emit({ ...project, tasks: counts }, () =>
        [
          `${project.name} (${project.slug})`,
          `  path:        ${project.path}`,
          `  repo:        ${project.repo ?? "(none)"}`,
          `  base branch: ${project.base_branch}`,
          `  tasks:       ${STATUSES.map((s) => `${s} ${counts[s]}`).join(" · ")}`,
        ].join("\n"),
      );
    },
  },
  {
    path: ["project", "remove"],
    summary: "Unregister a project and delete its tasks (the repo's .devit/ is kept)",
    args: "<slug>",
    options: { yes: { type: "boolean", short: "y", description: "confirm; required" } },
    run(ctx) {
      const slug = ctx.positionals[0];
      if (!slug) throw new DevitError("which project?", "devit project remove <slug> --yes");
      if (!ctx.values.yes) throw new DevitError(`this deletes every task of "${slug}"`, "add --yes to confirm");
      removeProject(ctx.db(), slug);
      ctx.emit({ removed: slug }, () => `Removed project "${slug}".`);
    },
  },
];
