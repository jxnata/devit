import { Database } from "bun:sqlite";
import { join } from "node:path";
import { devitHome } from "./paths.ts";

/**
 * Schema migrations, applied in order. `PRAGMA user_version` records how many ran.
 * Never edit a shipped migration: append a new one.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id          INTEGER PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL UNIQUE,
    repo        TEXT,
    base_branch TEXT NOT NULL DEFAULT 'main',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE tasks (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'backlog'
                CHECK (status IN ('backlog', 'todo', 'doing', 'review', 'done')),
    persona     TEXT,
    priority    TEXT NOT NULL DEFAULT 'normal'
                CHECK (priority IN ('low', 'normal', 'high')),
    source      TEXT NOT NULL DEFAULT 'user',
    created_by  TEXT NOT NULL DEFAULT 'user',
    issue_url   TEXT,
    pr_url      TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX tasks_project_status ON tasks (project_id, status);
  CREATE INDEX tasks_persona_status ON tasks (persona, status);

  CREATE TABLE comments (
    id          INTEGER PRIMARY KEY,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author      TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX comments_task ON comments (task_id);
  `,
  `
  CREATE TABLE runs (
    id          INTEGER PRIMARY KEY,
    persona     TEXT NOT NULL,
    project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    playbook    TEXT,
    trigger     TEXT NOT NULL DEFAULT 'manual',
    status      TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'done', 'silent', 'failed')),
    summary     TEXT,
    error       TEXT,
    cost_usd    REAL,
    turns       INTEGER,
    session_id  TEXT,
    pid         INTEGER,
    started_at  TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX runs_persona ON runs (persona, started_at);
  CREATE INDEX runs_status ON runs (status);
  `,
  `
  CREATE TABLE routines (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    persona     TEXT NOT NULL,
    project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    schedule    TEXT NOT NULL,
    playbook    TEXT,
    prompt      TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    next_run_at TEXT NOT NULL,
    last_run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL
  );
  ALTER TABLE runs ADD COLUMN routine_id INTEGER REFERENCES routines(id) ON DELETE SET NULL;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function dbPath(): string {
  return join(devitHome(), "devit.db");
}

export function openDb(path: string = dbPath()): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function schemaVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function migrate(db: Database): void {
  const current = schemaVersion(db);
  if (current > MIGRATIONS.length) {
    throw new Error(
      `database schema v${current} is newer than this devit (v${MIGRATIONS.length}); upgrade devit`,
    );
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
}

export function now(): string {
  return new Date().toISOString();
}
