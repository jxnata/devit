import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb, SCHEMA_VERSION, schemaVersion } from "../src/core/db.ts";
import { DevitError } from "../src/core/errors.ts";
import { upsertProject } from "../src/core/projects.ts";
import {
  addComment,
  addTask,
  listComments,
  listTasks,
  parseStatus,
  parseTaskId,
  removeTask,
  updateTask,
} from "../src/core/tasks.ts";

let db: Database;
let projectId: number;

beforeEach(() => {
  db = openDb(":memory:");
  projectId = upsertProject(db, "/tmp/devit-unit-app", { slug: "app", name: "App", repo: null, base_branch: "main" }).id;
});
afterEach(() => db.close());

describe("schema", () => {
  test("migrates to the latest version", () => {
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
  });
});

describe("tasks", () => {
  test("defaults: backlog, normal priority, created by the user", () => {
    const t = addTask(db, { projectId, title: "  Write docs  " });
    expect(t).toMatchObject({ title: "Write docs", status: "backlog", priority: "normal", created_by: "user", project: "app" });
  });

  test("rejects an empty title", () => {
    expect(() => addTask(db, { projectId, title: "   " })).toThrow(DevitError);
  });

  test("lists high priority first, then oldest first", () => {
    addTask(db, { projectId, title: "a" });
    addTask(db, { projectId, title: "b", priority: "high" });
    addTask(db, { projectId, title: "c", priority: "low" });
    addTask(db, { projectId, title: "d" });
    expect(listTasks(db).map((t) => t.title)).toEqual(["b", "a", "d", "c"]);
  });

  test("filters by status and persona", () => {
    addTask(db, { projectId, title: "a", status: "todo", persona: "dev" });
    addTask(db, { projectId, title: "b", status: "todo", persona: "writer" });
    addTask(db, { projectId, title: "c", status: "done", persona: "dev" });
    expect(listTasks(db, { statuses: ["todo"], persona: "dev" }).map((t) => t.title)).toEqual(["a"]);
    expect(listTasks(db, { statuses: ["todo", "done"] })).toHaveLength(3);
  });

  test("updates fields and bumps updated_at", async () => {
    const t = addTask(db, { projectId, title: "a" });
    await Bun.sleep(5);
    const u = updateTask(db, t.id, { status: "doing", persona: "dev", pr_url: "https://github.com/a/b/pull/1" });
    expect(u).toMatchObject({ status: "doing", persona: "dev", pr_url: "https://github.com/a/b/pull/1" });
    expect(u.updated_at > t.updated_at).toBe(true);
  });

  test("the database refuses an unknown status", () => {
    const t = addTask(db, { projectId, title: "a" });
    expect(() => updateTask(db, t.id, { status: "nope" as never })).toThrow();
  });

  test("comments are kept in order and removed with the task", () => {
    const t = addTask(db, { projectId, title: "a" });
    addComment(db, t.id, "user", "first");
    addComment(db, t.id, "dev", "second");
    expect(listComments(db, t.id).map((c) => `${c.author}:${c.body}`)).toEqual(["user:first", "dev:second"]);
    removeTask(db, t.id);
    expect(listComments(db, t.id)).toEqual([]);
  });

  test("missing task is a DevitError", () => {
    expect(() => updateTask(db, 999, { title: "x" })).toThrow("no task #999");
  });
});

describe("parsers", () => {
  test("status accepts labels and any case", () => {
    expect(parseStatus("TODO")).toBe("todo");
    expect(parseStatus("To do")).toBe("todo");
    expect(parseStatus("to_do")).toBe("todo");
    expect(() => parseStatus("later")).toThrow(DevitError);
  });

  test("task id accepts #12", () => {
    expect(parseTaskId("#12")).toBe(12);
    expect(() => parseTaskId("abc")).toThrow(DevitError);
    expect(() => parseTaskId(undefined)).toThrow(DevitError);
  });
});
