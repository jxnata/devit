import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DevitError } from "../core/errors.ts";
import { localTime } from "../core/format.ts";
import { ghReady, syncProject } from "../core/github.ts";
import { devitHome } from "../core/paths.ts";
import { listProjects } from "../core/projects.ts";
import { dueRoutines, listRoutines } from "../core/routines.ts";
import { reapOrphans } from "../core/runs.ts";
import { Scheduler } from "../core/scheduler.ts";
import type { Command } from "../framework.ts";
import { str } from "../framework.ts";
import { startWeb, type WebServer } from "../web/server.ts";

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
  summary: "Run the daemon and the web board: routines, autopickup, GitHub sync",
  details: `
Keeps running until stopped (Ctrl-C or SIGTERM, which interrupts running agents cleanly).
Every --interval seconds it starts:
  - routines whose time came; one missed while the daemon was down runs once on start
  - tasks in To do assigned to a persona with \`autopickup: true\` (a failure sends them to the backlog)
A persona runs one thing at a time. Only one daemon runs per DEVIT_HOME.

The board is at http://127.0.0.1:7420. To reach it from elsewhere, put it behind a tunnel
(Cloudflare Tunnel + Access, Tailscale, ssh -L) and allow that hostname with --allowed-host, or
serve it with --host 0.0.0.0 --token <secret>. See docs/board.md.

Every --sync-minutes it runs \`devit github sync\` for projects with a repo, if \`gh\` is logged in.
--once does a single pass and waits for its runs, without the board, for system cron or CI.`,
  options: {
    once: { type: "boolean", description: "one pass: start what is due, wait for it, exit" },
    interval: { type: "string", value: "seconds", description: "how often to look for work (default 30)" },
    "max-parallel": { type: "string", value: "n", description: "runs at the same time (default 3)" },
    port: { type: "string", value: "port", description: "board port (default 7420, or DEVIT_PORT)" },
    host: { type: "string", value: "host", description: "board address (default 127.0.0.1)" },
    token: { type: "string", value: "secret", description: "require this token on the board (or DEVIT_TOKEN)" },
    "allowed-host": { type: "string", multiple: true, value: "name", description: "hostname a tunnel serves the board on (repeatable)" },
    "no-web": { type: "boolean", description: "no board, just the daemon" },
    "sync-minutes": { type: "string", value: "n", description: "GitHub sync interval (default 15; 0 turns it off)" },
  },
  async run(ctx) {
    const interval = Number(str(ctx.values.interval) ?? 30);
    const maxParallel = Number(str(ctx.values["max-parallel"]) ?? 3);
    const port = Number(str(ctx.values.port) ?? process.env.DEVIT_PORT ?? 7420);
    const syncMinutes = Number(str(ctx.values["sync-minutes"]) ?? 15);
    if (!(interval > 0)) throw new DevitError("--interval must be a positive number of seconds");
    if (!Number.isInteger(maxParallel) || maxParallel < 1) throw new DevitError("--max-parallel must be a whole number ≥ 1");
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new DevitError("--port must be 0-65535");
    if (!(syncMinutes >= 0)) throw new DevitError("--sync-minutes must be 0 or more");

    const lock = pidFile();
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8").trim());
      if (pid && pid !== process.pid && alive(pid)) {
        throw new DevitError(`devit serve is already running (pid ${pid})`, `stop it first, or remove ${lock} if that is wrong`);
      }
    }
    const releaseLock = () => {
      if (existsSync(lock) && readFileSync(lock, "utf8").trim() === String(process.pid)) rmSync(lock);
    };
    const db = ctx.db();
    // With --json, stdout carries only the result.
    const log = (line: string) => (ctx.json ? console.error : ctx.out)(`[${stamp()}] ${line}`);
    const scheduler = new Scheduler({ db, maxParallel, log });

    if (ctx.values.once) {
      writeFileSync(lock, `${process.pid}\n`);
      try {
        reapOrphans(db);
        const started = scheduler.tick();
        await scheduler.idle();
        ctx.emit({ started }, () => (started ? `Done: ${started} run(s).` : "Nothing due."));
      } finally {
        releaseLock();
      }
      return;
    }

    let web: WebServer | null = null;
    if (!ctx.values["no-web"]) {
      web = startWeb({
        db,
        host: str(ctx.values.host) ?? "127.0.0.1",
        port,
        token: str(ctx.values.token) ?? process.env.DEVIT_TOKEN ?? null,
        allowedHosts: (ctx.values["allowed-host"] as string[] | undefined) ?? [],
        onWork: () => scheduler.tick(),
        log,
      });
    }
    writeFileSync(lock, `${process.pid}\n`);

    const sync = () => {
      if (!ghReady()) return;
      for (const project of listProjects(db)) {
        if (!project.repo || !existsSync(project.path)) continue;
        try {
          const r = syncProject(db, project);
          if (r.imported.length || r.done.length) log(`github ${project.slug}: ${r.imported.length} imported, ${r.done.length} done`);
        } catch (err) {
          log(`github ${project.slug}: ${(err as Error).message}`);
        }
      }
    };

    try {
      const reaped = reapOrphans(db);
      if (reaped) log(`marked ${reaped} interrupted run(s) as failed`);
      const routines = listRoutines(db).filter((r) => r.enabled);
      const missed = dueRoutines(db).length;
      log(`devit serve up: ${routines.length} routine(s)${missed ? `, ${missed} due now` : ""}, checking every ${interval}s, up to ${maxParallel} at once`);
      if (web) log(`board at ${web.url}`);

      let stopping = false;
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => scheduler.tick(), interval * 1000);
        const syncTimer = syncMinutes > 0 ? setInterval(sync, syncMinutes * 60_000) : null;
        const shutdown = (signal: string) => {
          if (stopping) return;
          stopping = true;
          clearInterval(timer);
          if (syncTimer) clearInterval(syncTimer);
          const running = scheduler.running;
          log(`${signal}: stopping${running.length ? `, interrupting ${running.join(", ")}` : ""}`);
          Promise.all([scheduler.stop(), web?.stop()]).then(() => resolve());
        };
        process.on("SIGINT", () => shutdown("SIGINT"));
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        if (syncMinutes > 0) sync();
        scheduler.tick();
      });
      log("stopped");
    } finally {
      releaseLock();
    }
  },
};
