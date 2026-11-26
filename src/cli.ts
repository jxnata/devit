#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" };
import { commands } from "./commands/index.ts";
import { DevitError } from "./core/errors.ts";
import { findCommand, mainHelp, runCommand } from "./framework.ts";

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(mainHelp(commands, pkg.version));
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
    console.log(pkg.version);
    return 0;
  }
  const found = findCommand(commands, argv);
  if (!found) {
    const group = commands.filter((c) => c.path[0] === argv[0]);
    const hint = group.length
      ? `try: ${group.map((c) => `devit ${c.path.join(" ")}`).join(", ")}`
      : "run `devit --help` for the list of commands";
    throw new DevitError(`unknown command "${argv.slice(0, 2).join(" ")}"`, hint);
  }
  await runCommand(found.command, found.rest);
  return Number(process.exitCode ?? 0);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof DevitError) {
    console.error(`devit: ${err.message}`);
    if (err.hint) console.error(`  ${err.hint}`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
}
