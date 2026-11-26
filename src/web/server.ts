import type { Database } from "bun:sqlite";
import { timingSafeEqual } from "node:crypto";
import pkg from "../../package.json" with { type: "json" };
import { ask } from "../core/ask.ts";
import { DevitError } from "../core/errors.ts";
import { listPersonas } from "../core/personas.ts";
import { getProjectBySlug, listProjects, type Project } from "../core/projects.ts";
import { listRoutines } from "../core/routines.ts";
import { readRunLog } from "../core/runner.ts";
import { getRun, listRuns, type Run } from "../core/runs.ts";
import {
  addComment,
  addTask,
  getTask,
  listComments,
  listTasks,
  parsePriority,
  parseStatus,
  removeTask,
  type TaskPatch,
  updateTask,
} from "../core/tasks.ts";
import boardBundle from "./board.html" with { type: "text" };

// Imported as text (a string at runtime); the type definitions only know HTML bundles.
const boardHtml = boardBundle as unknown as string;

export interface WebOptions {
  db: Database;
  host: string;
  port: number;
  /** Required unless bound to loopback. */
  token?: string | null;
  /** Extra Host names accepted without a token (e.g. a Cloudflare Tunnel hostname). */
  allowedHosts?: string[];
  /** Called when a change may give the daemon new work (a card moved to To do). */
  onWork?: () => void;
  log?: (line: string) => void;
}

export interface WebServer {
  url: string;
  stop(): Promise<void>;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const COOKIE = "devit_token";

export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function hostname(hostHeader: string): string {
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0]!;
}

const LOGIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Devit</title><style>body{font:15px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f6f4;color:#1c1c1a}
@media(prefers-color-scheme:dark){body{background:#151513;color:#ecece8}input{background:#222;color:inherit;border-color:#444}}
form{display:flex;gap:8px;flex-wrap:wrap;padding:16px}input{padding:8px 10px;border:1px solid #ccc;border-radius:6px;font:inherit;min-width:240px}
button{padding:8px 14px;border-radius:6px;border:0;background:#2f6fde;color:#fff;font:inherit;cursor:pointer}</style></head>
<body><form method="get" action="/"><input name="token" type="password" placeholder="Devit token" autofocus required><button>Open board</button></form></body></html>`;

/** The board and its JSON API, served by `devit serve`. */
export function startWeb(opts: WebOptions): WebServer {
  const { db } = opts;
  const token = opts.token || null;
  if (!token && !isLoopback(opts.host)) {
    throw new DevitError(
      `refusing to serve the board on ${opts.host} without a token`,
      "pass --token (or DEVIT_TOKEN), or keep the default 127.0.0.1 behind a tunnel",
    );
  }
  const allowedHosts = new Set([...LOOPBACK, ...(opts.allowedHosts ?? []).map((h) => h.toLowerCase())]);
  const asks = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const log = opts.log ?? (() => {});

  const project = (slug: string | null | undefined): Project => {
    if (!slug) throw new HttpError(400, "project is required");
    const p = getProjectBySlug(db, slug);
    if (!p) throw new HttpError(404, `no project "${slug}"`);
    return p;
  };

  const taskDetail = (id: number) => ({
    ...getTask(db, id),
    comments: listComments(db, id),
    runs: listRuns(db, { taskId: id, limit: 20 }),
  });

  async function body(req: Request): Promise<Record<string, unknown>> {
    if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
      throw new HttpError(415, "send JSON (content-type: application/json)");
    }
    const data = await req.json().catch(() => null);
    if (!data || typeof data !== "object") throw new HttpError(400, "invalid JSON body");
    return data as Record<string, unknown>;
  }

  const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  async function api(req: Request, url: URL): Promise<Response> {
    const parts = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
    const [resource, idText, sub] = parts;
    const id = idText ? Number(idText) : NaN;
    const method = req.method;

    if (resource === "meta" && method === "GET") {
      return json({
        version: pkg.version,
        projects: listProjects(db).map((p) => ({
          ...p,
          open: listTasks(db, { projectId: p.id, statuses: ["backlog", "todo", "doing", "review"] }).length,
        })),
      });
    }

    if (resource === "board" && method === "GET") {
      const p = project(url.searchParams.get("project"));
      const running = listRuns(db, { projectId: p.id, statuses: ["running"], limit: 50 });
      let personas: unknown[] = [];
      try {
        personas = listPersonas(p.path).map((x) => ({ name: x.name, role: x.role, lead: x.lead, autopickup: x.autopickup }));
      } catch (err) {
        log(`board: ${(err as Error).message}`);
      }
      return json({
        project: p,
        tasks: listTasks(db, { projectId: p.id }),
        personas,
        running: running.map((r) => ({ id: r.id, persona: r.persona, task_id: r.task_id, trigger: r.trigger })),
      });
    }

    if (resource === "tasks") {
      if (!idText && method === "POST") {
        const b = await body(req);
        const p = project(text(b.project));
        const task = addTask(db, {
          projectId: p.id,
          title: text(b.title) ?? "",
          body: text(b.body) ?? "",
          status: b.status ? parseStatus(String(b.status)) : "backlog",
          persona: text(b.persona) || null,
          priority: b.priority ? parsePriority(String(b.priority)) : "normal",
        });
        if (task.status === "todo") opts.onWork?.();
        return json(taskDetail(task.id), 201);
      }
      if (!Number.isInteger(id)) throw new HttpError(404, "not found");
      if (!sub && method === "GET") return json(taskDetail(id));
      if (!sub && method === "PATCH") {
        const b = await body(req);
        const patch: TaskPatch = {};
        if (b.title !== undefined) patch.title = String(b.title);
        if (b.body !== undefined) patch.body = String(b.body);
        if (b.status !== undefined) patch.status = parseStatus(String(b.status));
        if (b.priority !== undefined) patch.priority = parsePriority(String(b.priority));
        if (b.persona !== undefined) patch.persona = b.persona ? String(b.persona) : null;
        const before = getTask(db, id);
        const task = updateTask(db, id, patch);
        if (task.status === "todo" && (before.status !== "todo" || before.persona !== task.persona)) opts.onWork?.();
        return json(taskDetail(id));
      }
      if (!sub && method === "DELETE") {
        removeTask(db, id);
        return json({ removed: id });
      }
      if (sub === "comments" && method === "POST") {
        const b = await body(req);
        const content = (text(b.body) ?? "").trim();
        if (!content) throw new HttpError(400, "a comment needs text");
        getTask(db, id);
        addComment(db, id, "user", content);
        return json(taskDetail(id), 201);
      }
    }

    if (resource === "runs" && method === "GET") {
      if (!idText) {
        const slug = url.searchParams.get("project");
        const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50) || 50);
        return json(listRuns(db, { projectId: slug ? project(slug).id : undefined, limit }));
      }
      if (!Number.isInteger(id)) throw new HttpError(404, "not found");
      const run: Run = getRun(db, id);
      return json({ ...run, ...readRunLog(id) });
    }

    if (resource === "routines" && method === "GET" && !idText) {
      const slug = url.searchParams.get("project");
      const p = slug ? project(slug) : null;
      return json(listRoutines(db).filter((r) => !p || r.project_id === p.id || r.project_id === null));
    }

    if (resource === "ask" && method === "POST" && !idText) {
      const b = await body(req);
      const p = b.project ? project(text(b.project)) : null;
      const started = new Promise<Run>((resolve, reject) => {
        const work = ask({
          db,
          project: p,
          message: text(b.message) ?? "",
          persona: text(b.persona) || null,
          continue: Boolean(b.continue),
          signal: asks.signal,
          onStart: resolve,
        })
          .then((run) => log(`ask #${run.id}: ${run.status}`))
          .catch(reject)
          .finally(() => pending.delete(work));
        pending.add(work);
      });
      const run = await started;
      log(`ask #${run.id}: ${run.persona} (board)`);
      return json(run, 202);
    }

    throw new HttpError(404, "not found");
  }

  const server = Bun.serve({
    hostname: opts.host,
    port: opts.port,
    async fetch(req) {
      const url = new URL(req.url);
      const host = hostname(req.headers.get("host") ?? "").toLowerCase();

      // Authentication: a token if one is set; otherwise only known hosts (DNS rebinding).
      if (token) {
        const given = url.searchParams.get("token");
        if (given && sameToken(given, token) && req.method === "GET" && !url.pathname.startsWith("/api/")) {
          const secure = url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
          return new Response(null, {
            status: 302,
            headers: {
              location: url.pathname,
              "set-cookie": `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? "; Secure" : ""}`,
            },
          });
        }
        const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const presented = bearer ?? cookie(req, COOKIE);
        if (!presented || !sameToken(presented, token)) {
          if (url.pathname.startsWith("/api/")) return json({ error: "unauthorized" }, 401);
          return new Response(LOGIN_PAGE, { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
        }
      } else if (!allowedHosts.has(host)) {
        return json({ error: `host "${host}" not allowed`, hint: "start devit serve with --allowed-host or --token" }, 403);
      }

      // Writes only from the board's own origin.
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        if (origin && new URL(origin).host.toLowerCase() !== (req.headers.get("host") ?? "").toLowerCase()) {
          return json({ error: "cross-origin request refused" }, 403);
        }
      }

      if (url.pathname.startsWith("/api/")) {
        try {
          return await api(req, url);
        } catch (err) {
          if (err instanceof HttpError) return json({ error: err.message }, err.status);
          if (err instanceof DevitError) {
            return json({ error: err.message, hint: err.hint ?? null }, /^no (task|run|project|routine)\b/.test(err.message) ? 404 : 400);
          }
          log(`web error: ${(err as Error).stack ?? err}`);
          return json({ error: "internal error" }, 500);
        }
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return new Response(boardHtml, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  const shownHost = opts.host.includes(":") ? `[${opts.host}]` : opts.host;
  return {
    url: `http://${shownHost}:${server.port}`,
    async stop() {
      asks.abort();
      await Promise.all(pending);
      await server.stop(true);
    },
  };
}
