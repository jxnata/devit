import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli.ts");

export interface Sandbox {
  root: string;
  home: string;
  /** Runs the CLI with DEVIT_HOME pointed at this sandbox. */
  devit(args: string[], opts?: { cwd?: string; env?: Record<string, string> }): { code: number; stdout: string; stderr: string };
  json<T = unknown>(args: string[], opts?: { cwd?: string; env?: Record<string, string> }): T;
  /** A git repo with one commit, optionally with a `develop` branch and an origin remote. */
  repo(name: string, opts?: { develop?: boolean; origin?: string }): string;
  cleanup(): void;
}

function sh(cwd: string, ...cmd: string[]): void {
  const res = Bun.spawnSync(cmd, { cwd, stdout: "ignore", stderr: "pipe" });
  if (res.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${res.stderr.toString()}`);
}

export function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "devit-test-"));
  const home = join(root, "home");
  const sb: Sandbox = {
    root,
    home,
    devit(args, opts = {}) {
      const env: Record<string, string | undefined> = { ...process.env, TZ: "UTC", DEVIT_HOME: home, ...opts.env };
      if (!opts.env?.DEVIT_PERSONA) delete env.DEVIT_PERSONA;
      const res = Bun.spawnSync([process.execPath, CLI, ...args], {
        cwd: opts.cwd ?? root,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      return { code: res.exitCode, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
    },
    json(args, opts) {
      const res = sb.devit([...args, "--json"], opts);
      if (res.code !== 0) throw new Error(`devit ${args.join(" ")} failed (${res.code}): ${res.stderr}`);
      return JSON.parse(res.stdout);
    },
    repo(name, opts = {}) {
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      sh(dir, "git", "init", "-q", "-b", "main");
      sh(dir, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
      if (opts.develop) sh(dir, "git", "branch", "develop");
      if (opts.origin) sh(dir, "git", "remote", "add", "origin", opts.origin);
      return dir;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
  return sb;
}
