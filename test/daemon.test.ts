import { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Routine } from "../src/core/routines.ts";
import type { Run } from "../src/core/runs.ts";
import type { Task } from "../src/core/tasks.ts";
import { sandbox } from "./helpers.ts";

const sb = sandbox();
afterAll(() => sb.cleanup());

const record = join(sb.root, "calls.jsonl");
const fakeEnv = (mode = "report") => ({
  DEVIT_CLAUDE_BIN: resolve(import.meta.dir, "fake-claude.ts"),
  DEVIT_TEST_CLI: resolve(import.meta.dir, "../src/cli.ts"),
  FAKE_MODE: mode,
  FAKE_RECORD: record,
});
const calls = () => (existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
beforeEach(() => rmSync(record, { force: true }));

/** Makes routines due now by moving their next run into the past. */
function makeDue(...names: string[]) {
  const db = new Database(join(sb.home, "devit.db"));
  for (const name of names) {
    db.query("UPDATE routines SET next_run_at = '2000-01-01T00:00:00.000Z' WHERE name = ?").run(name);
  }
  db.close();
}

const dir = sb.repo("site", { origin: "https://github.com/acme/site.git" });
sb.json(["init"], { cwd: dir });
sb.json(["persona", "add", "lead", "--role", "Team lead", "--lead"]);
sb.json(["persona", "add", "pm", "--role", "Project manager"]);
sb.json(["persona", "add", "writer", "--role", "Writer"]);
mkdirSync(join(dir, ".devit", "playbooks"), { recursive: true });
writeFileSync(join(dir, ".devit/playbooks/weekly.md"), "Write the weekly report.\n");

describe("routines", () => {
  test("add validates persona, playbook and cron; list shows the next run", () => {
    expect(sb.devit(["routine", "add", "x", "--persona", "nobody", "--cron", "@daily", "--prompt", "hi"], { cwd: dir }).stderr).toContain('no persona "nobody"');
    expect(sb.devit(["routine", "add", "x", "--persona", "pm", "--cron", "@daily", "--playbook", "nope"], { cwd: dir }).stderr).toContain('no playbook "nope"');
    expect(sb.devit(["routine", "add", "x", "--persona", "pm", "--cron", "0 25 * * *", "--prompt", "hi"], { cwd: dir }).stderr).toContain("hour");
    expect(sb.devit(["routine", "add", "x", "--persona", "pm", "--cron", "@daily"], { cwd: dir }).stderr).toContain("needs something to do");

    const r = sb.json<Routine>(["routine", "add", "weekly", "--persona", "pm", "--cron", "0 9 * * 1", "--playbook", "weekly"], { cwd: dir });
    expect(r).toMatchObject({ name: "weekly", project: "site", enabled: 1 });
    expect(new Date(r.next_run_at).getDay()).toBe(1);
    expect(new Date(r.next_run_at).getHours()).toBe(9);
    expect(sb.devit(["routine", "add", "weekly", "--persona", "pm", "--cron", "@daily", "--prompt", "x"], { cwd: dir }).stderr).toContain("already exists");

    sb.json(["routine", "add", "ideas", "--persona", "writer", "--cron", "0 8 * * *", "--prompt", "Find post ideas"], { cwd: dir });
    const out = sb.devit(["routine", "list"], { cwd: dir }).stdout;
    expect(out).toContain("Mondays at 09:00");
    expect(out).toContain("daily at 08:00");
  });

  test("pause and resume", () => {
    expect(sb.json<Routine>(["routine", "pause", "ideas"]).enabled).toBe(0);
    makeDue("ideas");
    expect(sb.json<{ started: number }>(["serve", "--once"], { env: fakeEnv() }).started).toBe(0);
    const resumed = sb.json<Routine>(["routine", "resume", "ideas"]);
    expect(resumed.enabled).toBe(1);
    expect(Date.parse(resumed.next_run_at)).toBeGreaterThan(Date.now()); // no catch-up for paused time
  });

  test("a due routine runs once on serve; a silent one stays quiet", () => {
    makeDue("weekly", "ideas");
    const res = sb.json<{ started: number }>(["serve", "--once"], { env: fakeEnv("silent") });
    expect(res.started).toBe(2);
    expect(calls()).toHaveLength(2);
    const weekly = sb.json<Routine>(["routine", "show", "weekly"]);
    expect(weekly.last_status).toBe("silent");
    expect(Date.parse(weekly.next_run_at)).toBeGreaterThan(Date.now()); // missed runs collapse into one
    const runs = sb.json<Run[]>(["runs", "-a"]);
    expect(runs.filter((r) => r.trigger === "routine")).toHaveLength(2);
    expect(calls().find((c) => c.env.DEVIT_PERSONA === "pm").prompt).toContain('Follow the playbook "weekly"');

    // Nothing due now.
    expect(sb.json<{ started: number }>(["serve", "--once"], { env: fakeEnv() }).started).toBe(0);
  });

  test("routine run runs it now without moving the schedule", () => {
    const before = sb.json<Routine>(["routine", "show", "ideas"]);
    const run = sb.json<Run>(["routine", "run", "ideas"], { env: fakeEnv("plain") });
    expect(run).toMatchObject({ status: "done", trigger: "routine", routine_id: before.id });
    const after = sb.json<Routine>(["routine", "show", "ideas"]);
    expect(after.next_run_at).toBe(before.next_run_at);
    expect(after.last_run_id).toBe(run.id);
  });

  test("one run at a time per persona; --max-parallel caps the rest", () => {
    sb.json(["routine", "add", "pm-two", "--persona", "pm", "--cron", "@daily", "--prompt", "second"], { cwd: dir });
    makeDue("weekly", "pm-two", "ideas");
    expect(sb.json<{ started: number }>(["serve", "--once", "--max-parallel", "1"], { env: fakeEnv("silent") }).started).toBe(1);
    expect(sb.json<{ started: number }>(["serve", "--once"], { env: fakeEnv("silent") }).started).toBe(2); // pm's other + writer
    expect(sb.json<{ started: number }>(["serve", "--once"], { env: fakeEnv("silent") }).started).toBe(0);
    sb.json(["routine", "remove", "pm-two"]);
    expect(sb.devit(["routine", "show", "pm-two"]).stderr).toContain('no routine "pm-two"');
  });
});

describe("autopickup", () => {
  test("todo tasks of autopickup personas run; others wait", () => {
    writeFileSync(join(sb.home, "personas", "dev.md"), "---\nrole: Developer\nautopickup: true\n---\nYou fix bugs.\n");
    const picked = sb.json<Task>(["task", "add", "Fix footer", "-s", "todo", "--persona", "dev"], { cwd: dir });
    const later = sb.json<Task>(["task", "add", "Fix header", "-s", "todo", "--persona", "dev"], { cwd: dir });
    const manual = sb.json<Task>(["task", "add", "Write post", "-s", "todo", "--persona", "writer"], { cwd: dir });
    const backlog = sb.json<Task>(["task", "add", "Someday", "--persona", "dev"], { cwd: dir });

    expect(sb.json<{ started: number }>(["serve", "--once"], { env: fakeEnv("report") }).started).toBe(1);
    expect(sb.json<Task>(["task", "show", String(picked.id)]).status).toBe("review");
    expect(sb.json<Task>(["task", "show", String(later.id)]).status).toBe("todo"); // next pass
    expect(sb.json<Task>(["task", "show", String(manual.id)]).status).toBe("todo"); // writer has no autopickup
    expect(sb.json<Task>(["task", "show", String(backlog.id)]).status).toBe("backlog");

    sb.json(["serve", "--once"], { env: fakeEnv("report") });
    expect(sb.json<Task>(["task", "show", String(later.id)]).status).toBe("review");
  });

  test("a failed pickup goes to the backlog instead of looping", () => {
    const task = sb.json<Task>(["task", "add", "Broken", "-s", "todo", "--persona", "dev"], { cwd: dir });
    sb.json(["serve", "--once"], { env: fakeEnv("error") });
    const after = sb.json<Task & { comments: { body: string }[] }>(["task", "show", String(task.id)]);
    expect(after.status).toBe("backlog");
    expect(after.comments.at(-1)?.body).toContain("Moved to backlog");
    expect(sb.json<{ started: number }>(["serve", "--once"], { env: fakeEnv("error") }).started).toBe(0);
  });
});

describe("devit ask", () => {
  test("runs the lead with the message and prints its answer", () => {
    const res = sb.devit(["ask", "What", "is", "in", "review?"], { cwd: dir, env: fakeEnv("plain") });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Final answer text");
    const call = calls().at(-1);
    expect(call.env.DEVIT_PERSONA).toBe("lead");
    expect(call.prompt).toBe("What is in review?");
    expect(call.args.join(" ")).toContain("You are the lead.");
    expect(call.args).not.toContain("--resume");
    expect(sb.json<Run[]>(["runs", "--persona", "lead"], { cwd: dir })[0]!.trigger).toBe("ask");
  });

  test("--continue resumes the last conversation here", () => {
    sb.devit(["ask", "-c", "And the next one?"], { cwd: dir, env: fakeEnv("plain") });
    const args: string[] = calls().at(-1).args;
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-1");
    expect(sb.devit(["ask", "-c", "hi"], { env: fakeEnv("plain") }).stderr).toContain("no earlier conversation"); // outside the project
  });

  test("--persona talks to someone else; no lead is a clear error", () => {
    sb.devit(["ask", "--persona", "writer", "Any ideas?"], { cwd: dir, env: fakeEnv("plain") });
    expect(calls().at(-1).env.DEVIT_PERSONA).toBe("writer");
    const empty = sandbox();
    try {
      expect(empty.devit(["ask", "hello"]).stderr).toContain("there is no lead persona");
    } finally {
      empty.cleanup();
    }
  });
});

describe("devit serve (daemon)", () => {
  test("runs on its interval, refuses a second copy and stops cleanly on SIGTERM", async () => {
    makeDue("weekly");
    const env: Record<string, string | undefined> = { ...process.env, TZ: "UTC", ...fakeEnv("silent"), DEVIT_HOME: sb.home };
    delete env.DEVIT_PERSONA;
    const daemon = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/cli.ts"), "serve", "--interval", "0.2", "--no-web", "--sync-minutes", "0"], {
      cwd: sb.root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const pidFile = join(sb.home, "serve.pid");
    for (let i = 0; i < 50 && !existsSync(pidFile); i++) await Bun.sleep(100);
    expect(sb.devit(["serve", "--once"]).stderr).toContain("already running");

    for (let i = 0; i < 100 && sb.json<Routine>(["routine", "show", "weekly"]).last_status !== "silent"; i++) await Bun.sleep(100);
    daemon.kill("SIGTERM");
    expect(await daemon.exited).toBe(0);
    const out = await new Response(daemon.stdout).text();
    expect(out).toContain("devit serve up");
    expect(out).toMatch(/run #\d+: pm on routine weekly/);
    expect(out).toContain("SIGTERM: stopping");
    expect(existsSync(pidFile)).toBe(false);
  }, 20_000);

  test("SIGTERM interrupts a running agent and records it", async () => {
    writeFileSync(join(sb.home, "personas", "slowpoke.md"), "---\nrole: Slow\n---\nSlow.\n");
    sb.json(["routine", "add", "slow", "--persona", "slowpoke", "--cron", "@daily", "--prompt", "wait"], { cwd: dir });
    makeDue("slow");
    const env: Record<string, string | undefined> = { ...process.env, TZ: "UTC", ...fakeEnv("sleep"), DEVIT_HOME: sb.home };
    delete env.DEVIT_PERSONA;
    const daemon = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/cli.ts"), "serve", "--interval", "0.2", "--no-web", "--sync-minutes", "0"], {
      cwd: sb.root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    for (let i = 0; i < 100 && sb.json<Routine>(["routine", "show", "slow"]).last_status !== "running"; i++) await Bun.sleep(100);
    daemon.kill("SIGTERM");
    expect(await daemon.exited).toBe(0);
    const slow = sb.json<Routine>(["routine", "show", "slow"]);
    expect(slow.last_status).toBe("failed");
    expect(sb.json<Run>(["runs", "show", String(slow.last_run_id)]).error).toBe("interrupted");
  }, 30_000);
});
