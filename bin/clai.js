#!/usr/bin/env node
/**
 * Thin CLI entry — delegates to tsx so `clai --help` needs no prior build.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.tsx");
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", cli, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    cwd: root,
    // tsx resolves from the package root, so forward where the user actually is.
    env: { ...process.env, CLAI_INVOCATION_CWD: process.cwd() },
  },
);
process.exit(result.status ?? 1);
