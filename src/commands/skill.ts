import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DevitError } from "../core/errors.ts";
import skillText from "../skill/SKILL.md" with { type: "text" };
import { type Command, type Context, table } from "../framework.ts";

/** Where each coding agent looks for skills, relative to the home folder or a repo. */
const AGENTS: Record<string, { dir: string; label: string }> = {
  claude: { dir: ".claude", label: "Claude Code" },
  codex: { dir: ".codex", label: "Codex" },
  agents: { dir: ".agents", label: "Agent Skills (~/.agents)" },
};

interface Target {
  agent: string;
  file: string;
}

function targets(ctx: Context): Target[] {
  const asked = (ctx.values.for as string[] | undefined) ?? [];
  for (const a of asked) {
    if (!(a in AGENTS) && a !== "all") throw new DevitError(`unknown agent "${a}"`, `use ${Object.keys(AGENTS).join(", ")} or all`);
  }
  const base = ctx.values.repo ? ctx.project().path : homedir();
  let agents: string[];
  if (asked.includes("all")) agents = Object.keys(AGENTS);
  else if (asked.length) agents = asked;
  // Default: Claude Code, plus the other agents whose folder already exists.
  else agents = Object.keys(AGENTS).filter((a) => a === "claude" || existsSync(join(base, AGENTS[a]!.dir)));
  return agents.map((agent) => ({ agent, file: join(base, AGENTS[agent]!.dir, "skills", "devit", "SKILL.md") }));
}

const forOption = {
  for: { type: "string" as const, multiple: true, value: "agent", description: "claude, codex, agents or all (default: claude + the ones installed)" },
  repo: { type: "boolean" as const, description: "in the current project's repo (.claude/skills/…) instead of your home folder" },
};

export const skillCommands: Command[] = [
  {
    path: ["skill", "install"],
    summary: "Install the devit skill so Claude Code and Codex can drive Devit",
    details: `
Writes SKILL.md to ~/.claude/skills/devit/ (and ~/.codex/skills/devit/, ~/.agents/skills/devit/ when
those agents are installed). Run it again after upgrading Devit to update the skill. With --repo,
it goes into the current project instead (.claude/skills/devit/…), to commit with the code.

Then, in a Claude Code or Codex session, ask things like "add a task for dev to fix the login bug",
"what did the team do this week?" or "ask the lead to plan the pricing page".`,
    options: forOption,
    run(ctx) {
      const results = targets(ctx).map(({ agent, file }) => {
        const before = existsSync(file) ? readFileSync(file, "utf8") : null;
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, skillText);
        return { agent, file, status: before === null ? "installed" : before === skillText ? "unchanged" : "updated" };
      });
      ctx.emit(results, () => table(results.map((r) => [AGENTS[r.agent]!.label, r.status, r.file])));
    },
  },
  {
    path: ["skill", "uninstall"],
    summary: "Remove the devit skill",
    options: forOption,
    run(ctx) {
      const removed: Target[] = [];
      for (const t of targets(ctx)) {
        if (!existsSync(t.file)) continue;
        if (!/^name: devit$/m.test(readFileSync(t.file, "utf8"))) {
          throw new DevitError(`${t.file} is not the devit skill; leaving it alone`);
        }
        rmSync(join(t.file, ".."), { recursive: true });
        removed.push(t);
      }
      ctx.emit(removed, () => (removed.length ? removed.map((r) => `Removed ${r.file}`).join("\n") : "The skill was not installed."));
    },
  },
  {
    path: ["skill", "show"],
    summary: "Print the skill (SKILL.md)",
    run(ctx) {
      ctx.emit({ text: skillText }, () => skillText.trimEnd());
    },
  },
];
