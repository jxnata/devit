import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sandbox } from "./helpers.ts";

const sb = sandbox();
const dir = sb.repo("web", { origin: "https://github.com/acme/web.git" });
sb.json(["init"], { cwd: dir });
sb.json(["persona", "add", "lead", "--role", "Team lead", "--lead"]);
writeFileSync(join(sb.home, "personas", "dev.md"), "---\nrole: Developer\nautopickup: true\n---\nYou fix bugs.\n");

// The server runs in this process, against the sandbox's home, with the fake agent.
Object.assign(process.env, {
  DEVIT_HOME: sb.home,
  DEVIT_CLAUDE_BIN: resolve(import.meta.dir, "fake-claude.ts"),
  DEVIT_TEST_CLI: resolve(import.meta.dir, "../src/cli.ts"),
  FAKE_MODE: "report",
});
delete process.env.DEVIT_PERSONA;

const { openDb } = await import("../src/core/db.ts");
const { Scheduler } = await import("../src/core/scheduler.ts");
const { startWeb } = await import("../src/web/server.ts");

const db = openDb();
const scheduler = new Scheduler({ db });
let open: Awaited<ReturnType<typeof startWeb>>;
let secured: Awaited<ReturnType<typeof startWeb>>;
beforeAll(() => {
  open = startWeb({ db, host: "127.0.0.1", port: 0, onWork: () => scheduler.tick(), allowedHosts: ["devit.example.com"] });
  secured = startWeb({ db, host: "127.0.0.1", port: 0, token: "s3cret" });
});
afterAll(async () => {
  await scheduler.stop();
  await open.stop();
  await secured.stop();
  db.close();
  sb.cleanup();
});

async function call<T = any>(path: string, init: RequestInit & { json?: unknown } = {}, base = open.url): Promise<{ status: number; body: T }> {
  const { json, ...rest } = init;
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers as Record<string, string>) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    redirect: "manual",
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body };
}

async function until(check: () => Promise<boolean>, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await check()) return;
    await Bun.sleep(100);
  }
  throw new Error("timed out waiting");
}

describe("board API", () => {
  test("serves the board page and the project list", async () => {
    const page = await call("/");
    expect(page.status).toBe(200);
    expect(page.body).toContain("<title>Devit</title>");
    const meta = await call("/api/meta");
    expect(meta.body.projects.map((p: { slug: string }) => p.slug)).toEqual(["web"]);
  });

  test("create, edit, comment and delete a task", async () => {
    const created = await call("/api/tasks", { method: "POST", json: { project: "web", title: "Fix nav", body: "On mobile", priority: "high" } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: "Fix nav", status: "backlog", priority: "high", comments: [], runs: [] });
    const id = created.body.id;

    const edited = await call(`/api/tasks/${id}`, { method: "PATCH", json: { title: "Fix the nav", persona: "lead" } });
    expect(edited.body).toMatchObject({ title: "Fix the nav", persona: "lead" });
    const commented = await call(`/api/tasks/${id}/comments`, { method: "POST", json: { body: "Only Safari" } });
    expect(commented.body.comments).toEqual([expect.objectContaining({ author: "user", body: "Only Safari" })]);

    const board = await call("/api/board?project=web");
    expect(board.body.tasks.map((t: { id: number }) => t.id)).toContain(id);
    expect(board.body.personas.map((p: { name: string }) => p.name)).toEqual(["lead", "dev"]);

    expect((await call(`/api/tasks/${id}`, { method: "PATCH", json: { status: "nope" } })).body.error).toContain("status");
    expect((await call(`/api/tasks/${id}`, { method: "DELETE" })).body).toEqual({ removed: id });
    expect((await call(`/api/tasks/${id}`)).status).toBe(404);
    expect((await call("/api/board?project=nope")).status).toBe(404);
  });

  test("moving a card to To do makes the persona work", async () => {
    const { body: task } = await call("/api/tasks", { method: "POST", json: { project: "web", title: "Fix footer", persona: "dev" } });
    await call(`/api/tasks/${task.id}`, { method: "PATCH", json: { status: "todo" } });
    await until(async () => (await call(`/api/tasks/${task.id}`)).body.status === "review");
    const after = (await call(`/api/tasks/${task.id}`)).body;
    expect(after.comments.at(-1)).toMatchObject({ author: "dev", body: "Fixed it in PR #3" });
    expect(after.runs[0]).toMatchObject({ persona: "dev", status: "done", trigger: "task" });

    const run = (await call(`/api/runs/${after.runs[0].id}`)).body;
    expect(run.events).toContain("Looking at it.\n→ Bash: git status");
    expect(run.output).toBe("Final answer text");
    expect((await call("/api/runs?project=web")).body.length).toBeGreaterThan(0);
  });

  test("ask the lead from the board", async () => {
    const started = await call("/api/ask", { method: "POST", json: { project: "web", message: "What is in review?" } });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ persona: "lead", trigger: "ask", status: "running" });
    await until(async () => Boolean((await call(`/api/runs/${started.body.id}`)).body.finished_at));
    expect((await call(`/api/runs/${started.body.id}`)).body).toMatchObject({ status: "done", output: "Final answer text" });
    expect((await call("/api/ask", { method: "POST", json: { project: "web", message: " " } })).status).toBe(400);
  });

  test("routines list", async () => {
    sb.json(["routine", "add", "nightly", "--persona", "dev", "--cron", "@daily", "--prompt", "check"], { cwd: dir });
    const routines = (await call("/api/routines?project=web")).body;
    expect(routines.map((r: { name: string }) => r.name)).toEqual(["nightly"]);
    expect(routines[0].schedule_text).toBe("daily at 00:00");
  });
});

describe("board security", () => {
  test("writes need JSON and the board's own origin", async () => {
    const form = await call("/api/tasks", { method: "POST", body: "project=web&title=x", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(form.status).toBe(415);
    const cross = await call("/api/tasks", { method: "POST", json: { project: "web", title: "x" }, headers: { origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
  });

  test("without a token, only loopback and allowed hosts (DNS rebinding)", async () => {
    expect((await call("/api/meta", { headers: { host: "evil.example:7420" } })).status).toBe(403);
    expect((await call("/api/meta", { headers: { host: "devit.example.com" } })).status).toBe(200);
  });

  test("with a token: login page, ?token sets a cookie, bearer works", async () => {
    const page = await call("/", {}, secured.url);
    expect(page.status).toBe(401);
    expect(page.body).toContain("Devit token");
    expect((await call("/api/meta", {}, secured.url)).status).toBe(401);
    expect((await call("/api/meta", { headers: { authorization: "Bearer wrong" } }, secured.url)).status).toBe(401);
    expect((await call("/api/meta", { headers: { authorization: "Bearer s3cret" } }, secured.url)).status).toBe(200);

    const login = await fetch(`${secured.url}/?token=s3cret`, { redirect: "manual" });
    expect(login.status).toBe(302);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect((await call("/api/meta", { headers: { cookie: cookie.split(";")[0]! } }, secured.url)).status).toBe(200);
    expect((await call("/api/meta", { headers: { host: "anything.example" } }, secured.url)).status).toBe(401); // token, not host, decides
  });

  test("refuses a public address without a token", () => {
    expect(() => startWeb({ db, host: "0.0.0.0", port: 0 })).toThrow("without a token");
  });
});
