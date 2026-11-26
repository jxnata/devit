import { DevitError } from "../core/errors.ts";
import {
  getMemory,
  listMemory,
  type MemoryEntry,
  removeMemory,
  saveMemory,
  SCOPES,
  type Scope,
  type ScopeRef,
  scopeLabel,
  searchMemory,
  visibleScopes,
} from "../core/memory.ts";
import { type Command, type Context, str, table } from "../framework.ts";

const scopeOptions = {
  scope: { type: "string" as const, short: "s", value: "scope", description: "global, project or persona" },
  persona: { type: "string" as const, value: "name", description: "persona for the persona scope (default: the running persona)" },
};

function personaName(ctx: Context): string | undefined {
  return str(ctx.values.persona) ?? (ctx.actor !== "user" ? ctx.actor : undefined);
}

function explicitScope(ctx: Context): ScopeRef | null {
  const value = str(ctx.values.scope);
  if (!value) return null;
  if (!SCOPES.includes(value as Scope)) throw new DevitError(`unknown scope "${value}"`, `use one of: ${SCOPES.join(", ")}`);
  const scope = value as Scope;
  if (scope === "global") return { scope };
  if (scope === "project") return { scope, owner: ctx.project().slug };
  const persona = personaName(ctx);
  if (!persona) throw new DevitError("which persona?", "pass --persona <name>");
  return { scope, owner: persona };
}

/** Every scope visible from here: global, the current project's, the persona's. */
function visible(ctx: Context): ScopeRef[] {
  return visibleScopes(ctx.maybeProject()?.slug, personaName(ctx));
}

function entryJson({ file, ...e }: MemoryEntry) {
  return { ...e, file };
}

export const memoryCommands: Command[] = [
  {
    path: ["memory", "add"],
    summary: "Save a fact (same name replaces it)",
    args: "<name>",
    details: `
Scope defaults to the current project, or global outside one.

Example:
  devit memory add release-process --description "How releases ship" --body "PR develop → main, merge commit"`,
    options: {
      description: { type: "string", short: "d", value: "text", description: "one line: what this is and when it matters (required)" },
      body: { type: "string", short: "b", value: "text", description: "the full fact (default: the description)" },
      ...scopeOptions,
    },
    run(ctx) {
      const name = ctx.positionals[0];
      if (!name) throw new DevitError("a memory needs a name", "devit memory add <name> --description \"...\"");
      const description = str(ctx.values.description) ?? "";
      const ref = explicitScope(ctx) ?? (ctx.maybeProject() ? { scope: "project" as const, owner: ctx.project().slug } : { scope: "global" as const });
      const entry = saveMemory(ref, { name, description, body: str(ctx.values.body) ?? description, author: ctx.actor });
      ctx.emit(entryJson(entry), () => `Saved "${entry.name}" in ${scopeLabel(ref)}.`);
    },
  },
  {
    path: ["memory", "list"],
    summary: "List what is remembered (global, project and persona scopes)",
    options: scopeOptions,
    run(ctx) {
      const one = explicitScope(ctx);
      const refs = one ? [one] : visible(ctx);
      const entries = refs.flatMap((ref) => listMemory(ref));
      ctx.emit(entries.map(entryJson), () =>
        entries.length === 0
          ? "Nothing remembered yet."
          : table(entries.map((e) => [scopeLabel(e), e.name, e.description]), ["SCOPE", "NAME", "DESCRIPTION"]),
      );
    },
  },
  {
    path: ["memory", "show"],
    summary: "Show a memory entry (looks in persona, then project, then global)",
    args: "<name>",
    options: scopeOptions,
    run(ctx) {
      const name = ctx.positionals[0];
      if (!name) throw new DevitError("which memory?", "devit memory show <name>");
      const one = explicitScope(ctx);
      const refs = one ? [one] : visible(ctx).reverse();
      for (const ref of refs) {
        try {
          const e = getMemory(ref, name);
          ctx.emit(entryJson(e), () => `${e.name} (${scopeLabel(e)}, ${e.author}, ${e.updated.slice(0, 10)})\n${e.description}\n\n${e.body}`);
          return;
        } catch (err) {
          if (!(err instanceof DevitError)) throw err;
        }
      }
      throw new DevitError(`no memory "${name}"`, "see `devit memory list`");
    },
  },
  {
    path: ["memory", "search"],
    summary: "Search names, descriptions and text",
    args: "<term>",
    options: scopeOptions,
    run(ctx) {
      const term = ctx.positionals.join(" ");
      if (!term) throw new DevitError("search for what?", "devit memory search <term>");
      const one = explicitScope(ctx);
      const found = searchMemory(one ? [one] : visible(ctx), term);
      ctx.emit(found.map(entryJson), () =>
        found.length === 0 ? `Nothing matches "${term}".` : table(found.map((e) => [scopeLabel(e), e.name, e.description])),
      );
    },
  },
  {
    path: ["memory", "remove"],
    summary: "Delete a memory entry",
    args: "<name>",
    options: scopeOptions,
    run(ctx) {
      const name = ctx.positionals[0];
      if (!name) throw new DevitError("which memory?", "devit memory remove <name> --scope <scope>");
      const ref = explicitScope(ctx) ?? (ctx.maybeProject() ? { scope: "project" as const, owner: ctx.project().slug } : { scope: "global" as const });
      removeMemory(ref, name);
      ctx.emit({ removed: name, scope: scopeLabel(ref) }, () => `Deleted "${name}" from ${scopeLabel(ref)}.`);
    },
  },
];
