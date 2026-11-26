#!/usr/bin/env bun
/**
 * Stands in for the GitHub CLI in tests. FAKE_GH_DATA points at a JSON file:
 *   { "issues": [{number,title,body,url}], "states": {"<issue or pr url>": "OPEN|CLOSED|MERGED"} }
 * Every call is appended to FAKE_GH_RECORD, if set.
 */
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_GH_RECORD) appendFileSync(process.env.FAKE_GH_RECORD, `${JSON.stringify(args)}\n`);
const data = JSON.parse(readFileSync(process.env.FAKE_GH_DATA!, "utf8"));
const [group, verb] = args;

if (group === "auth" && verb === "status") process.exit(0);
if (group === "issue" && verb === "list") {
  const label = args[args.indexOf("--label") + 1];
  console.log(JSON.stringify(data.issues.filter((i: { labels?: string[] }) => (i.labels ?? ["devit"]).includes(label!))));
  process.exit(0);
}
if ((group === "issue" || group === "pr") && verb === "view") {
  const state = data.states?.[args[2]!];
  if (!state) {
    console.error(`no such ${group}: ${args[2]}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ state }));
  process.exit(0);
}
console.error(`fake gh: unsupported ${args.join(" ")}`);
process.exit(1);
