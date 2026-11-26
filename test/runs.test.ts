import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Run } from "../src/core/runs.ts";
import type { Task } from "../src/core/tasks.ts";
import { sandbox } from "./helpers.ts";

const sb = sandbox();
afterAll(() => sb.cleanup());

const record = join(sb.root, "calls.jsonl");
const fakeEnv = (mode: string) => ({
  DEVIT_CLAUDE_BIN: resolve(import.meta.dir, "fake-claude.ts"),
  DEVIT_TEST_CLI: resolve(import.meta.dir, "../src/cli.ts"),
  FAKE_MODE: mode,
  FAKE_RECORD: record,
});
const lastCall = () => JSON.parse(readFileSync(record, "utf8").trim().split("\n").pop()!);

const dir = sb.repo("shop", { develop: true, origin: "https://github.com/acme/shop.git" });
sb.json(["init"], { cwd: dir });

describe("personas", () => {
  test("add creates a file from the template; list and show read it", () => {
    sb.json(["persona", "add", "dev", "--role", "Developer", "--model", "opus", "-i", "You fix bugs."]);
    sb.json(["persona", "add", "pm", "--role", "Project manager", "--lead"]);
    const list = sb.json<{ name: string; lead: boolean; model: string }[]>(["persona", "list"]);
    expect(list.map((p) => p.name)).toEqual(["pm", "dev"]); // lead first
    const dev = sb.json<{ role: string; model: string; allowed_tools: string[]; instructions: string; timeout_minutes: number }>(["persona", "show", "dev"]);
    expect(dev).toMatchObject({ role: "Developer", model: "opus", instructions: "You fix bugs.", timeout_minutes: 30 });
    expect(dev.allowed_tools).toContain("Bash(devit:*)");
  });

  test("only one lead, reserved and invalid names refused", () => {
    expect(sb.devit(["persona", "add", "boss", "--lead"]).stderr).toContain('"pm" is already the lead');
    expect(sb.devit(["persona", "add", "done"]).stderr).toContain("reserved");
    expect(sb.devit(["persona", "add", "Dev X"]).stderr).toContain("invalid persona name");
  });

  test("a project file overrides the global persona", () => {
    sb.json(["persona", "add", "dev", "--local", "--role", "Shop developer"], { cwd: dir });
    const local = sb.json<{ role: string; scope: string }>(["persona", "show", "dev"], { cwd: dir });
    expect(local).toMatchObject({ role: "Shop developer", scope: "project" });
    const global = sb.json<{ role: string }>(["persona", "show", "dev"]);
    expect(global.role).toBe("Developer");
    sb.json(["persona", "remove", "dev", "--local"], { cwd: dir });
  });

  test("bad frontmatter is reported with the file", () => {
    writeFileSync(join(sb.home, "personas", "broken.md"), "---\neffort: huge\n---\nhi\n");
    expect(sb.devit(["persona", "list"]).stderr).toContain("effort in");
    sb.devit(["persona", "remove", "broken"]);
  });
});

describe("memory", () => {
  test("add, list, show, search and remove across scopes", () => {
    sb.json(["memory", "add", "stack", "-d", "Bun and SQLite everywhere", "-s", "global"]);
    sb.json(["memory", "add", "deploy", "-d", "Deploys go through a PR to main", "-b", "Never squash."], { cwd: dir });
    sb.json(["memory", "add", "style", "-d", "Short commit messages", "-s", "persona", "--persona", "dev"]);

    const fromProject = sb.json<{ name: string; scope: string }[]>(["memory", "list"], { cwd: dir });
    expect(fromProject.map((e) => `${e.scope}:${e.name}`)).toEqual(["global:stack", "project:deploy"]);

    const asDev = sb.json<{ name: string }[]>(["memory", "list"], { cwd: dir, env: { DEVIT_PERSONA: "dev" } });
    expect(asDev.map((e) => e.name)).toEqual(["stack", "deploy", "style"]);

    expect(sb.json<{ body: string }>(["memory", "show", "deploy"], { cwd: dir }).body).toBe("Never squash.");
    expect(sb.json<{ name: string }[]>(["memory", "search", "SQUASH"], { cwd: dir }).map((e) => e.name)).toEqual(["deploy"]);

    const index = readFileSync(join(sb.home, "memory/projects/shop/MEMORY.md"), "utf8");
    expect(index).toContain("- deploy: Deploys go through a PR to main");

    sb.json(["memory", "remove", "deploy"], { cwd: dir });
    expect(readFileSync(join(sb.home, "memory/projects/shop/MEMORY.md"), "utf8")).not.toContain("deploy");
  });

  test("a description is required", () => {
    expect(sb.devit(["memory", "add", "x"]).stderr).toContain("one-line description");
  });
});

describe("devit run", () => {
  test("dry run shows the prompt with persona, project, memory and task", () => {
    const task = sb.json<Task>(["task", "add", "Fix checkout", "-b", "Total is wrong", "-s", "todo"], { cwd: dir });
    sb.json(["task", "comment", String(task.id), "Only with coupons"], { cwd: dir });
    const out = sb.json<{ command: string[]; system: string; user: string }>(["run", "dev", "--task", String(task.id), "--dry-run"], { cwd: dir });
    expect(out.command).toContain("--model");
    expect(out.command).toContain("opus");
    expect(out.system).toContain("You fix bugs.");
    expect(out.system).toContain("Base branch for PRs: develop");
    expect(out.system).toContain("- stack: Bun and SQLite everywhere");
    expect(out.system).toContain("- pm: Project manager (lead)");
    expect(out.user).toContain(`Work on task #${task.id}: Fix checkout`);
    expect(out.user).toContain("- user: Only with coupons");
    expect(sb.json<Task>(["task", "show", String(task.id)], { cwd: dir }).status).toBe("todo"); // untouched
  });

  test("a reporting agent: run done, task to review, cost recorded, env passed", () => {
    const task = sb.json<Task>(["task", "add", "Fix login", "-s", "todo"], { cwd: dir });
    const run = sb.json<Run>(["run", "dev", "--task", String(task.id)], { cwd: dir, env: fakeEnv("report") });
    expect(run).toMatchObject({ status: "done", summary: "Fixed the thing", cost_usd: 0.12, turns: 3, session_id: "sess-1", trigger: "task" });

    const call = lastCall();
    expect(call.env).toEqual({ DEVIT_RUN_ID: String(run.id), DEVIT_PERSONA: "dev", DEVIT_PROJECT: "shop", DEVIT_TASK_ID: String(task.id) });
    expect(call.cwd).toBe(dir);
    expect(call.args).toContain("--append-system-prompt");
    expect(call.prompt).toContain("Fix login");

    const after = sb.json<Task & { comments: { author: string; body: string }[] }>(["task", "show", String(task.id)], { cwd: dir });
    expect(after.status).toBe("review");
    expect(after.comments).toEqual([expect.objectContaining({ author: "dev", body: "Fixed it in PR #3" })]);
    expect(sb.json<{ author: string }>(["memory", "show", "fake-fact"], { cwd: dir }).author).toBe("dev");
    expect(existsSync(join(sb.home, "runs", `${run.id}.jsonl`))).toBe(true);
  });

  test("an agent that does not report: done with its final text", () => {
    const run = sb.json<Run>(["run", "dev", "--prompt", "say hi"], { cwd: dir, env: fakeEnv("plain") });
    expect(run).toMatchObject({ status: "done", summary: "Final answer text", trigger: "manual" });
  });

  test("silent run puts the task back", () => {
    const task = sb.json<Task>(["task", "add", "Maybe nothing", "-s", "todo"], { cwd: dir });
    const run = sb.json<Run>(["run", "dev", "--task", String(task.id)], { cwd: dir, env: fakeEnv("silent") });
    expect(run.status).toBe("silent");
    expect(sb.json<Task>(["task", "show", String(task.id)], { cwd: dir }).status).toBe("todo");
  });

  test("failed run: exit 1, task back with a comment", () => {
    const task = sb.json<Task>(["task", "add", "Will fail", "-s", "todo"], { cwd: dir });
    const res = sb.devit(["run", "dev", "--task", String(task.id), "--json"], { cwd: dir, env: fakeEnv("error") });
    expect(res.code).toBe(1);
    const run = JSON.parse(res.stdout) as Run;
    expect(run).toMatchObject({ status: "failed", error: "boom: something broke" });
    const after = sb.json<Task & { comments: { author: string; body: string }[] }>(["task", "show", String(task.id)], { cwd: dir });
    expect(after.status).toBe("todo");
    expect(after.comments.at(-1)?.body).toContain("failed: boom");
  });

  test("timeout kills the agent", () => {
    const personaDir = join(dir, ".devit", "personas");
    mkdirSync(personaDir, { recursive: true });
    writeFileSync(join(personaDir, "slow.md"), "---\nrole: Slow\ntimeout_minutes: 0.01\n---\nSlow.\n");
    const res = sb.devit(["run", "slow", "--prompt", "wait", "--json"], { cwd: dir, env: fakeEnv("sleep") });
    expect(JSON.parse(res.stdout)).toMatchObject({ status: "failed", error: "timed out after 0.01 min" });
  }, 20_000);

  test("missing runner binary is a clear failure", () => {
    const res = sb.devit(["run", "dev", "--prompt", "x", "--json"], { cwd: dir, env: { DEVIT_CLAUDE_BIN: "/nope/claude" } });
    expect(JSON.parse(res.stdout).error).toBe("runner not found: /nope/claude");
  });

  test("playbooks come from the project, then the global folder", () => {
    writeFileSync(join(dir, ".devit/playbooks/weekly.md"), "1. Read the numbers\n2. Write the report\n");
    const out = sb.json<{ user: string }>(["run", "pm", "--playbook", "weekly", "--prompt", "be brief", "--dry-run"], { cwd: dir });
    expect(out.user).toContain('Follow the playbook "weekly"');
    expect(out.user).toContain("2. Write the report");
    expect(out.user).toContain("Also: be brief");
    expect(sb.devit(["run", "pm", "--playbook", "nope", "--dry-run"], { cwd: dir }).stderr).toContain('no playbook "nope"');
  });

  test("run done outside a run is refused; twice is refused", () => {
    expect(sb.devit(["run", "done", "-s", "x"]).stderr).toContain("not inside a run");
    const runs = sb.json<Run[]>(["runs", "-s", "done"], { cwd: dir });
    const res = sb.devit(["run", "done", "-s", "again"], { env: { DEVIT_RUN_ID: String(runs[0]!.id) } });
    expect(res.stderr).toContain("already ended");
  });

  test("runs lists and filters; runs show reads one", () => {
    const runs = sb.json<Run[]>(["runs"], { cwd: dir });
    expect(runs.length).toBeGreaterThanOrEqual(6);
    expect(sb.json<Run[]>(["runs", "--failed"], { cwd: dir }).every((r) => r.status === "failed")).toBe(true);
    const one = sb.json<Run & { log: string }>(["runs", "show", String(runs[0]!.id)], { cwd: dir });
    expect(one.log).toEndWith(`${runs[0]!.id}.jsonl`);
    expect(sb.devit(["runs"], { cwd: dir }).stdout).toContain("PERSONA");
  });
});
