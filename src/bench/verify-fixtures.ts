/**
 * One-shot fixture matrix: for each task, check must FAIL on broken sources
 * and PASS after overlaying `_solution/`. Not part of the public CLI.
 *
 *   pnpm exec tsx src/bench/verify-fixtures.ts
 */

import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadBenchTasks } from "./runner.js";
import { resolveBenchFixturesRoot } from "./index.js";

function runCheck(cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["check.mjs"],
      { cwd, timeout: 30_000, windowsHide: true },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === "number"
            ? Number((err as { code: number }).code)
            : err
              ? 1
              : 0;
        resolve({ code, out: `${stdout ?? ""}${stderr ?? ""}`.trim() });
      },
    );
  });
}

async function withWorkdir(
  fixtureDir: string,
  applySolution: boolean,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clai-bench-verify-"));
  try {
    await cp(fixtureDir, dir, {
      recursive: true,
      filter: (src) => {
        const name = path.basename(src);
        return name !== "_solution" && name !== "task.json";
      },
    });
    if (applySolution) {
      await cp(path.join(fixtureDir, "_solution"), dir, {
        recursive: true,
        force: true,
      });
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(
      () => {},
    );
  }
}

async function main(): Promise<number> {
  const tasks = await loadBenchTasks(resolveBenchFixturesRoot());
  console.log(`Verifying ${tasks.length} bench fixtures…\n`);
  console.log(
    `${"id".padEnd(22)} ${"broken".padEnd(8)} ${"solution".padEnd(10)} ok?`,
  );
  let failed = 0;
  for (const task of tasks) {
    let brokenCode = -1;
    let solvedCode = -1;
    await withWorkdir(task.dir, false, async (dir) => {
      brokenCode = (await runCheck(dir)).code;
    });
    await withWorkdir(task.dir, true, async (dir) => {
      solvedCode = (await runCheck(dir)).code;
    });
    const ok = brokenCode !== 0 && solvedCode === 0;
    if (!ok) failed++;
    console.log(
      `${task.id.padEnd(22)} ${String(brokenCode).padEnd(8)} ${String(solvedCode).padEnd(10)} ${ok ? "OK" : "BAD"}`,
    );
  }
  console.log(
    failed === 0
      ? `\nAll ${tasks.length} fixtures OK (fail on broken, pass on _solution).`
      : `\n${failed} fixture(s) failed the matrix.`,
  );
  return failed === 0 ? 0 : 1;
}

process.exit(await main());
