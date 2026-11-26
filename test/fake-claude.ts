#!/usr/bin/env bun
/**
 * Stands in for `claude -p --output-format stream-json` in tests. FAKE_MODE picks the behavior:
 *   report  comment on the task and call `devit run done` (default)
 *   plain   just print a result, like an agent that forgot to report
 *   silent  call `devit run silent`
 *   error   exit 1 with a message on stderr
 *   sleep   hang until killed (timeouts)
 *   dirty   leave an uncommitted file in its folder, then report done
 */
import { appendFileSync, writeFileSync } from "node:fs";

const mode = process.env.FAKE_MODE ?? "report";
const prompt = await new Response(Bun.stdin.stream()).text();
if (process.env.FAKE_RECORD) {
  appendFileSync(process.env.FAKE_RECORD, `${JSON.stringify({ args: process.argv.slice(2), prompt, cwd: process.cwd(), env: {
    DEVIT_RUN_ID: process.env.DEVIT_RUN_ID, DEVIT_PERSONA: process.env.DEVIT_PERSONA,
    DEVIT_PROJECT: process.env.DEVIT_PROJECT, DEVIT_TASK_ID: process.env.DEVIT_TASK_ID } })}\n`);
}
const emit = (event: unknown) => console.log(JSON.stringify(event));
const devit = (...args: string[]) => {
  const res = Bun.spawnSync([process.execPath, process.env.DEVIT_TEST_CLI!, ...args], { stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) throw new Error(`devit ${args.join(" ")}: ${res.stderr}`);
};

emit({ type: "system", subtype: "init", session_id: "sess-1" });
emit({ type: "assistant", message: { content: [{ type: "text", text: "Looking at it." }, { type: "tool_use", name: "Bash", input: { command: "git status" } }] } });

if (mode === "error") {
  console.error("boom: something broke");
  process.exit(1);
}
if (mode === "sleep") await Bun.sleep(60_000);
if (mode === "report") {
  if (process.env.DEVIT_TASK_ID) devit("task", "comment", process.env.DEVIT_TASK_ID, "Fixed it in PR #3");
  devit("memory", "add", "fake-fact", "--description", "Learned during a run", "--body", "details");
  devit("run", "done", "--summary", "Fixed the thing");
}
if (mode === "silent") devit("run", "silent");
if (mode === "dirty") {
  writeFileSync("half-done.txt", "wip\n");
  devit("run", "done", "--summary", "Left work behind");
}
emit({ type: "result", subtype: "success", is_error: false, result: "Final answer text", total_cost_usd: 0.12, num_turns: 3, session_id: "sess-1" });
