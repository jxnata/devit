import { accessSync, constants } from "node:fs";
import { dbPath, SCHEMA_VERSION, schemaVersion } from "../core/db.ts";
import { devitHome } from "../core/paths.ts";
import type { Command } from "../framework.ts";

type Level = "ok" | "warn" | "fail";
interface Check {
  name: string;
  level: Level;
  detail: string;
}

function version(cmd: string[]): string | null {
  try {
    const res = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore" });
    return res.exitCode === 0 ? res.stdout.toString().trim().split("\n")[0]! : null;
  } catch {
    return null;
  }
}

export const doctorCommand: Command = {
  path: ["doctor"],
  summary: "Check that Devit and the tools it drives are ready",
  run(ctx) {
    const checks: Check[] = [];
    const home = devitHome();
    try {
      accessSync(home, constants.W_OK);
      checks.push({ name: "home", level: "ok", detail: home });
    } catch {
      checks.push({ name: "home", level: "fail", detail: `${home} is not writable` });
    }
    try {
      const v = schemaVersion(ctx.db());
      checks.push({ name: "database", level: v === SCHEMA_VERSION ? "ok" : "fail", detail: `${dbPath()} (schema v${v})` });
    } catch (err) {
      checks.push({ name: "database", level: "fail", detail: (err as Error).message });
    }
    try {
      const p = ctx.maybeProject();
      checks.push(
        p
          ? { name: "project", level: "ok", detail: `${p.slug} (${p.path})` }
          : { name: "project", level: "warn", detail: "not inside a project; run `devit init` in a repo" },
      );
    } catch (err) {
      checks.push({ name: "project", level: "fail", detail: (err as Error).message });
    }
    const tools: [string, string[], string][] = [
      ["claude", ["claude", "--version"], "needed to run personas (Claude Code)"],
      ["git", ["git", "--version"], "needed for project detection"],
      ["gh", ["gh", "--version"], "optional: GitHub issues and PRs"],
    ];
    for (const [name, cmd, why] of tools) {
      const v = version(cmd);
      checks.push(v ? { name, level: "ok", detail: v } : { name, level: "warn", detail: `not found: ${why}` });
    }
    const failed = checks.some((c) => c.level === "fail");
    ctx.emit({ ok: !failed, checks }, () => {
      const icon: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };
      return checks.map((c) => `${icon[c.level]} ${c.name.padEnd(9)} ${c.detail}`).join("\n");
    });
    if (failed) process.exitCode = 1;
  },
};
