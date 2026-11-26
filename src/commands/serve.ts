import { localTime } from "../core/format.ts";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DevitError } from "../core/errors.ts";
import { devitHome } from "../core/paths.ts";
import { dueRoutines, listRoutines } from "../core/routines.ts";
import { reapOrphans } from "../core/runs.ts";
import { Scheduler } from "../core/scheduler.ts";
import type { Command } from "../framework.ts";
import { str } from "../framework.ts";

function pidFile(): string {
  return join(devitHome(), "serve.pid");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const stamp = () => localTime(new Date(), true);

export const serveCommand: Command = {
  path: ["serve"],
  summary: "Run the daemon: routines on schedule and autopickup of tasks",
  details: `
Keeps running until stopped (Ctrl-C or SIGTERM, which interrupts running agents cleanly).
Every --interval seconds it starts:
  - routines whose time came; one missed while the daemon was down runs once on start
  - tasks in To do assigned to a persona with \`autopickup: true\` (a failure sends them to the backlog)
A persona runs one thing at a time. Only one daemon runs per DEVIT_HOME.

--once does a single pass and waits for its runs, for system cron or CI.
See docs/daemon.md to keep it running with systemd.`,
  options: {
    once: { type: "boolean", description: "one pass: start what is due, wait for it, exit" },
    interval: { type: "string", value: "seconds", description: "how often to look for work (default 30)" },
    "max-parallel": { type: "string", value: "n", description: "runs at the same time (default 3)" },
  },
  async run(ctx) {
    const interval = Number(str(ctx.values.interval) ?? 30);
    const maxParallel = Number(str(ctx.values["max-parallel"]) ?? 3);
    if (!(interval > 0)) throw new DevitError("--interval must be a positive number of seconds");
    if (!Number.isInteger(maxParallel) || maxParallel < 1) throw new DevitError("--max-parallel must be a whole number ≥ 1");

    const lock = pidFile();
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8").trim());
      if (pid && pid !== process.pid && alive(pid)) {
        throw new DevitError(`devit serve is already running (pid ${pid})`, `stop it first, or remove ${lock} if that is wrong`);
      }
    }
    const db = ctx.db();
    writeFileSync(lock, `${process.pid}\n`);
    // With --json, stdout carries only the result.
    const log = (line: string) => (ctx.json ? console.error : ctx.out)(`[${stamp()}] ${line}`);
    const scheduler = new Scheduler({ db, maxParallel, log });

    try {
      const reaped = reapOrphans(db);
      if (reaped) log(`marked ${reaped} interrupted run(s) as failed`);
      const routines = listRoutines(db).filter((r) => r.enabled);
      const missed = dueRoutines(db).length;
      if (!ctx.values.once) {
        log(`devit serve up: ${routines.length} routine(s)${missed ? `, ${missed} due now` : ""}, checking every ${interval}s, up to ${maxParallel} at once`);
      }

      if (ctx.values.once) {
        const started = scheduler.tick();
        await scheduler.idle();
        ctx.emit({ started }, () => (started ? `Done: ${started} run(s).` : "Nothing due."));
        return;
      }

      let stopping = false;
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => scheduler.tick(), interval * 1000);
        const shutdown = (signal: string) => {
          if (stopping) return;
          stopping = true;
          clearInterval(timer);
          const running = scheduler.running;
          log(`${signal}: stopping${running.length ? `, interrupting ${running.join(", ")}` : ""}`);
          scheduler.stop().then(resolve);
        };
        process.on("SIGINT", () => shutdown("SIGINT"));
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        scheduler.tick();
      });
      log("stopped");
    } finally {
      if (existsSync(lock) && readFileSync(lock, "utf8").trim() === String(process.pid)) rmSync(lock);
    }
  },
};
