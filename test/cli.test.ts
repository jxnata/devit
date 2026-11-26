import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { parseGithubRepo, slugify } from "../src/core/projects.ts";
import type { Task } from "../src/core/tasks.ts";
import { sandbox } from "./helpers.ts";

const sb = sandbox();
afterAll(() => sb.cleanup());

describe("project detection", () => {
  test("parses GitHub remotes", () => {
    expect(parseGithubRepo("git@github.com:acme/app.git")).toBe("acme/app");
    expect(parseGithubRepo("https://github.com/acme/app")).toBe("acme/app");
    expect(parseGithubRepo("https://github.com/acme/app.git/")).toBe("acme/app");
    expect(parseGithubRepo("https://gitlab.com/acme/app.git")).toBeNull();
    expect(parseGithubRepo(null)).toBeNull();
  });

  test("slugifies folder names", () => {
    expect(slugify("My App")).toBe("my-app");
    expect(slugify("Ação_Final!")).toBe("acao-final");
  });
});

describe("devit init", () => {
  test("detects slug, repo and the develop branch, and writes project.yaml", () => {
    const dir = sb.repo("Love Memo", { develop: true, origin: "git@github.com:acme/lovememo.git" });
    const res = sb.json<{ created: boolean; project: { slug: string; repo: string; base_branch: string } }>(["init"], { cwd: dir });
    expect(res.created).toBe(true);
    expect(res.project).toMatchObject({ slug: "love-memo", repo: "acme/lovememo", base_branch: "develop" });
    const yaml = readFileSync(join(dir, ".devit/project.yaml"), "utf8");
    expect(yaml).toContain("slug: love-memo");
    expect(existsSync(join(dir, ".devit/playbooks"))).toBe(true);
  });

  test("falls back to the current branch without develop or origin", () => {
    const dir = sb.repo("plain");
    const res = sb.json<{ project: { base_branch: string; repo: string | null } }>(["init", "--slug", "plain-app"], { cwd: dir });
    expect(res.project).toMatchObject({ base_branch: "main", repo: null });
  });

  test("running it again re-registers without rewriting", () => {
    const dir = sb.repo("again");
    sb.json(["init", "--slug", "again"], { cwd: dir });
    const res = sb.json<{ created: boolean }>(["init", "--slug", "ignored"], { cwd: dir });
    expect(res.created).toBe(false);
  });

  test("refuses a slug another project uses", () => {
    sb.json(["init", "--slug", "taken"], { cwd: sb.repo("first") });
    const res = sb.devit(["init", "--slug", "taken"], { cwd: sb.repo("second") });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('slug "taken" is already used');
  });

  test("a moved repo keeps its slug and tasks", () => {
    const dir = sb.repo("moving");
    sb.json(["init", "--slug", "moving"], { cwd: dir });
    sb.json(["task", "add", "survives the move"], { cwd: dir });
    const moved = join(sb.root, "moved");
    renameSync(dir, moved);
    const tasks = sb.json<Task[]>(["task", "list"], { cwd: moved });
    expect(tasks.map((t) => t.title)).toEqual(["survives the move"]);
    const projects = sb.json<{ slug: string; path: string }[]>(["project", "list"]);
    expect(projects.find((p) => p.slug === "moving")?.path).toBe(moved);
  });

  test("a fresh clone with .devit/ registers itself on first use", () => {
    const dir = sb.repo("clone");
    mkdirSync(join(dir, ".devit"));
    Bun.write(join(dir, ".devit/project.yaml"), "slug: cloned\nname: Cloned\nrepo: null\nbase_branch: main\n");
    const task = sb.json<Task>(["task", "add", "hello"], { cwd: dir });
    expect(task.project).toBe("cloned");
  });
});

describe("devit task", () => {
  const dir = sb.repo("board", { develop: true });
  sb.json(["init", "--slug", "board"], { cwd: dir });

  test("add, move, assign, comment and show", () => {
    const t = sb.json<Task>(["task", "add", "Fix", "the", "crash", "--persona", "dev", "-s", "todo", "--priority", "high"], { cwd: dir });
    expect(t).toMatchObject({ title: "Fix the crash", status: "todo", persona: "dev", priority: "high" });

    sb.json(["task", "move", String(t.id), "doing"], { cwd: dir });
    sb.json(["task", "assign", `#${t.id}`, "none"], { cwd: dir });
    sb.json(["task", "comment", String(t.id), "found", "the", "cause"], { cwd: dir, env: { DEVIT_PERSONA: "dev" } });
    sb.json(["task", "link", String(t.id), "--pr", "https://github.com/a/b/pull/7"], { cwd: dir });

    const shown = sb.json<Task & { comments: { author: string; body: string }[] }>(["task", "show", String(t.id)], { cwd: dir });
    expect(shown).toMatchObject({ status: "doing", persona: null, pr_url: "https://github.com/a/b/pull/7" });
    expect(shown.comments).toEqual([expect.objectContaining({ author: "dev", body: "found the cause" })]);
  });

  test("tasks created by a persona record it", () => {
    const t = sb.json<Task>(["task", "add", "From the writer"], { cwd: dir, env: { DEVIT_PERSONA: "writer" } });
    expect(t).toMatchObject({ created_by: "writer", source: "persona" });
  });

  test("list hides done unless asked, and works from a subdirectory", () => {
    const t = sb.json<Task>(["task", "add", "Finished"], { cwd: dir });
    sb.json(["task", "move", String(t.id), "done"], { cwd: dir });
    const sub = join(dir, "src", "deep");
    mkdirSync(sub, { recursive: true });
    const open = sb.json<Task[]>(["task", "list"], { cwd: sub });
    expect(open.some((x) => x.id === t.id)).toBe(false);
    const all = sb.json<Task[]>(["task", "list", "--all"], { cwd: sub });
    expect(all.some((x) => x.id === t.id)).toBe(true);
    const done = sb.json<Task[]>(["task", "list", "-s", "done"], { cwd: sub });
    expect(done.map((x) => x.id)).toEqual([t.id]);
  });

  test("-p selects a project from anywhere", () => {
    const t = sb.json<Task>(["task", "add", "Remote add", "-p", "board"]);
    expect(t.project).toBe("board");
  });

  test("human output groups by column", () => {
    const res = sb.devit(["task", "list"], { cwd: dir });
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/^Backlog \(\d+\)/m);
  });

  test("clear errors with hints", () => {
    const outside = sb.devit(["task", "list"]);
    expect(outside.code).toBe(1);
    expect(outside.stderr).toContain("not inside a Devit project");

    const badStatus = sb.devit(["task", "move", "1", "later"], { cwd: dir });
    expect(badStatus.stderr).toContain("use one of: backlog, todo, doing, review, done");

    const unknown = sb.devit(["task", "frobnicate"], { cwd: dir });
    expect(unknown.stderr).toContain("devit task add");

    const badFlag = sb.devit(["task", "add", "x", "--nope"], { cwd: dir });
    expect(badFlag.code).toBe(1);
    expect(badFlag.stderr).toContain("--nope");
  });
});

describe("devit help and doctor", () => {
  test("--help lists every command", () => {
    const res = sb.devit(["--help"]);
    expect(res.stdout).toContain("task add <title>");
    expect(res.stdout).toContain("doctor");
  });

  test("doctor reports the database", () => {
    const res = sb.json<{ checks: { name: string; level: string }[] }>(["doctor"]);
    expect(res.checks.find((c) => c.name === "database")?.level).toBe("ok");
  });
});

describe("docs", () => {
  test("docs/cli.md matches the commands (run `bun run docs`)", async () => {
    const { cliReference } = await import("../scripts/cli-docs.ts");
    const current = readFileSync(join(import.meta.dir, "../docs/cli.md"), "utf8");
    expect(current).toBe(cliReference());
  });
});
