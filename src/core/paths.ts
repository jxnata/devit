import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const PROJECT_DIR = ".devit";
export const PROJECT_FILE = "project.yaml";

/** Where Devit keeps its database, personas, memory and run logs. Override with DEVIT_HOME. */
export function devitHome(): string {
  const home = process.env.DEVIT_HOME || join(homedir(), ".devit");
  mkdirSync(home, { recursive: true });
  return home;
}

export function projectFile(root: string): string {
  return join(root, PROJECT_DIR, PROJECT_FILE);
}

/** Walks up from `start` to the nearest directory holding `.devit/project.yaml`. */
export function findProjectRoot(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  while (true) {
    if (existsSync(projectFile(dir))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
