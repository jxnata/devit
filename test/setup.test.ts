import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sandbox } from "./helpers.ts";

const sb = sandbox();
afterAll(() => sb.cleanup());
const home = join(sb.root, "user-home");
mkdirSync(home, { recursive: true });
const dir = sb.repo("app");
sb.json(["init"], { cwd: dir });

describe("example personas", () => {
  test("examples are listed and load as valid personas", () => {
    const examples = sb.json<{ name: string; lead: boolean }[]>(["persona", "examples"]);
    expect(examples.map((e) => e.name)).toEqual(["lead", "dev", "pm", "writer", "reviewer"]);
    for (const e of examples) sb.json(["persona", "add", e.name, "--from", e.name]);
    const personas = sb.json<{ name: string; lead: boolean; autopickup: boolean }[]>(["persona", "list"]);
    expect(personas.find((p) => p.lead)?.name).toBe("lead");
    expect(personas.find((p) => p.name === "dev")).toMatchObject({ autopickup: true });
  });

  test("--from with overrides; a second lead example is demoted", () => {
    const res = sb.devit(["persona", "add", "boss", "--from", "lead"]);
    expect(res.stdout).toContain('"lead" is already the lead, so this one is not');
    expect(sb.json<{ lead: boolean }>(["persona", "show", "boss"]).lead).toBe(false);

    sb.json(["persona", "add", "fastdev", "--from", "dev", "--model", "haiku", "--role", "Quick fixes", "-i", "Only typos."]);
    expect(sb.json(["persona", "show", "fastdev"])).toMatchObject({ model: "haiku", role: "Quick fixes", instructions: "Only typos.", autopickup: true });
    expect(sb.devit(["persona", "add", "x", "--from", "nope"]).stderr).toContain('no persona example "nope"');
  });

  test("a template that would not load is never written", () => {
    expect(sb.devit(["persona", "add", "bad", "--model", "x\ny: [", "--role", "r"]).code).toBe(1);
    expect(existsSync(join(sb.home, "personas", "bad.md"))).toBe(false);
  });
});

describe("playbooks", () => {
  test("add from an example or the template, list and show", () => {
    sb.json(["playbook", "add", "weekly-report", "--from", "weekly-report"], { cwd: dir });
    sb.json(["playbook", "add", "notes", "--global"]);
    sb.json(["playbook", "add", "weekly-report", "--global", "--from", "friday-summary"]);
    const list = sb.json<{ name: string; scope: string }[]>(["playbook", "list"], { cwd: dir });
    expect(list.map((p) => `${p.scope}:${p.name}`)).toEqual(["project:weekly-report", "global:notes"]); // project shadows global
    expect(sb.json<{ text: string }>(["playbook", "show", "weekly-report"], { cwd: dir }).text).toContain("Monday report");
    expect(sb.json<{ text: string }>(["playbook", "show", "weekly-report"]).text).toContain("Friday summary");
    expect(sb.devit(["playbook", "add", "notes", "--global"]).stderr).toContain("already exists");

    // Usable by a run right away.
    const out = sb.json<{ user: string }>(["run", "pm", "--playbook", "weekly-report", "--dry-run"], { cwd: dir });
    expect(out.user).toContain("Needs you");
  });
});

describe("devit skill", () => {
  const env = { HOME: home };
  test("installs for Claude Code by default, and for agents already present", () => {
    const first = sb.json<{ agent: string; status: string; file: string }[]>(["skill", "install"], { env });
    expect(first.map((r) => `${r.agent}:${r.status}`)).toEqual(["claude:installed"]);
    const text = readFileSync(join(home, ".claude/skills/devit/SKILL.md"), "utf8");
    expect(text).toStartWith("---\nname: devit\ndescription: ");

    mkdirSync(join(home, ".codex"));
    const second = sb.json<{ agent: string; status: string }[]>(["skill", "install"], { env });
    expect(second.map((r) => `${r.agent}:${r.status}`)).toEqual(["claude:unchanged", "codex:installed"]);

    writeFileSync(join(home, ".claude/skills/devit/SKILL.md"), "---\nname: devit\n---\nold\n");
    expect(sb.json<{ status: string }[]>(["skill", "install", "--for", "claude"], { env })[0]!.status).toBe("updated");
  });

  test("--repo installs into the project; uninstall removes only ours", () => {
    sb.json(["skill", "install", "--repo", "--for", "all"], { cwd: dir, env });
    for (const d of [".claude", ".codex", ".agents"]) expect(existsSync(join(dir, d, "skills/devit/SKILL.md"))).toBe(true);

    writeFileSync(join(home, ".codex/skills/devit/SKILL.md"), "---\nname: something-else\n---\n");
    expect(sb.devit(["skill", "uninstall", "--for", "codex"], { env }).stderr).toContain("not the devit skill");
    const removed = sb.json<{ agent: string }[]>(["skill", "uninstall", "--for", "claude"], { env });
    expect(removed.map((r) => r.agent)).toEqual(["claude"]);
    expect(existsSync(join(home, ".claude/skills/devit"))).toBe(false);
  });

  test("every command the skill mentions exists", () => {
    const text = sb.json<{ text: string }>(["skill", "show"]).text;
    const commands = new Set([...text.matchAll(/^devit ([a-z]+(?: [a-z]+)?)/gm)].map((m) => m[1]!));
    expect(commands.size).toBeGreaterThan(15);
    for (const c of commands) {
      const res = sb.devit([...c.split(" "), "--help"]);
      expect(res.stderr, `devit ${c}`).not.toContain("unknown command");
    }
  });
});
