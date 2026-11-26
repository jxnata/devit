#!/usr/bin/env bun
/**
 * Builds the release archives: dist/release/devit-<os>-<arch>.tar.gz (each holding a `devit` binary)
 * and SHA256SUMS. Used by .github/workflows/release.yml; runs locally too.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TARGETS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"];
const root = join(import.meta.dir, "..");
const out = join(root, "dist", "release");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const sums: string[] = [];
for (const target of TARGETS) {
  const work = join(out, target);
  mkdirSync(work);
  const build = Bun.spawnSync(
    ["bun", "build", "--compile", "--minify", `--target=bun-${target}`, "src/cli.ts", "--outfile", join(work, "devit")],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (build.exitCode !== 0) throw new Error(`build failed for ${target}`);
  const archive = `devit-${target}.tar.gz`;
  const tar = Bun.spawnSync(["tar", "-czf", join(out, archive), "-C", work, "devit"], { stderr: "inherit" });
  if (tar.exitCode !== 0) throw new Error(`tar failed for ${target}`);
  rmSync(work, { recursive: true });
  sums.push(`${createHash("sha256").update(readFileSync(join(out, archive))).digest("hex")}  ${archive}`);
  console.log(`built ${archive}`);
}
writeFileSync(join(out, "SHA256SUMS"), `${sums.join("\n")}\n`);
console.log(`\n${sums.join("\n")}`);
