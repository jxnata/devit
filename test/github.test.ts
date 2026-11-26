import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SyncResult } from "../src/core/github.ts";
import type { Task } from "../src/core/tasks.ts";
import { sandbox } from "./helpers.ts";

const sb = sandbox();
afterAll(() => sb.cleanup());

const dataFile = join(sb.root, "gh.json");
const recordFile = join(sb.root, "gh-calls.jsonl");
const env = { DEVIT_GH_BIN: resolve(import.meta.dir, "fake-gh.ts"), FAKE_GH_DATA: dataFile, FAKE_GH_RECORD: recordFile };
const setGh = (data: unknown) => writeFileSync(dataFile, JSON.stringify(data));
const url = (n: number) => `https://github.com/acme/app/issues/${n}`;

const dir = sb.repo("app", { origin: "https://github.com/acme/app.git" });
sb.json(["init"], { cwd: dir });

describe("devit github sync", () => {
  test("imports labeled issues once, as backlog tasks", () => {
    setGh({
      issues: [
        { number: 7, title: "Crash on save", body: "Stack trace…", url: url(7) },
        { number: 3, title: "Typo on home", body: "", url: url(3) },
        { number: 9, title: "Not for us", body: "", url: url(9), labels: ["other"] },
      ],
      states: { [url(3)]: "OPEN", [url(7)]: "OPEN" },
    });
    const [res] = sb.json<SyncResult[]>(["github", "sync"], { cwd: dir, env });
    expect(res!.imported.map((t) => t.title)).toEqual(["Typo on home", "Crash on save"]); // by issue number
    expect(res!.imported[1]).toMatchObject({ status: "backlog", source: "github", created_by: "github", issue_url: url(7), body: "Stack trace…" });
    expect(readFileSync(recordFile, "utf8")).toContain('"--label","devit"');

    const again = sb.json<SyncResult[]>(["github", "sync"], { cwd: dir, env });
    expect(again[0]!.imported).toEqual([]);
  });

  test("a merged PR or a closed issue moves the task to done", () => {
    const tasks = sb.json<Task[]>(["task", "list"], { cwd: dir });
    const typo = tasks.find((t) => t.title === "Typo on home")!;
    const crash = tasks.find((t) => t.title === "Crash on save")!;
    const pr = "https://github.com/acme/app/pull/12";
    sb.json(["task", "link", String(crash.id), "--pr", pr], { cwd: dir });
    setGh({ issues: [], states: { [url(3)]: "CLOSED", [url(7)]: "OPEN", [pr]: "MERGED" } });

    const [res] = sb.json<SyncResult[]>(["github", "sync"], { cwd: dir, env });
    expect(res!.done.map((t) => t.id).sort()).toEqual([typo.id, crash.id].sort());
    const after = sb.json<Task & { comments: { author: string; body: string }[] }>(["task", "show", String(crash.id)], { cwd: dir });
    expect(after.status).toBe("done");
    expect(after.comments.at(-1)).toMatchObject({ author: "github", body: `PR merged: ${pr}` });
  });

  test("issue_label in project.yaml changes the label; no repo is skipped", () => {
    writeFileSync(join(dir, ".devit/project.yaml"), "slug: app\nname: app\nrepo: acme/app\nbase_branch: main\nissue_label: agents\n");
    setGh({ issues: [{ number: 20, title: "Labeled agents", body: "", url: url(20), labels: ["agents"] }], states: {} });
    expect(sb.json<SyncResult[]>(["github", "sync"], { cwd: dir, env })[0]!.imported.map((t) => t.title)).toEqual(["Labeled agents"]);

    const local = sb.repo("local");
    sb.json(["init"], { cwd: local });
    expect(sb.json<SyncResult[]>(["github", "sync"], { cwd: local, env })[0]!.skipped).toContain("no GitHub repo");
  });

  test("gh errors are reported", () => {
    const res = sb.devit(["github", "sync"], { cwd: dir, env: { ...env, FAKE_GH_DATA: "/nope.json" } });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("gh issue list failed");
  });
});
