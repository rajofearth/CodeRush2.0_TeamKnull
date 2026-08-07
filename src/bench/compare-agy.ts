/**
 * compare-agy — run the same 8-task bench against Antigravity CLI (`agy`)
 * and emit a side-by-side scorecard vs the latest CLAI live run (or a fresh
 * CLAI serial run if COMPARE_CLAI=1).
 *
 * Usage:
 *   pnpm exec tsx src/bench/compare-agy.ts
 *   pnpm exec tsx src/bench/compare-agy.ts --tasks off-by-one,fix-broken-import
 *   COMPARE_CLAI=1 pnpm exec tsx src/bench/compare-agy.ts
 *
 * agy model default: gemini-3.5-flash-low (closest to CLAI's flash-lite tier
 * on the Antigravity catalog). Override with AGY_MODEL=.
 */
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "../adapter/env.js";
import { loadBenchTasks, resolveBenchFixturesRoot } from "./index.js";
import { runBench } from "./runner.js";
import { BenchStore } from "./store.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await loadEnvFiles();
const AGY_MODEL = process.env.AGY_MODEL ?? "gemini-3.5-flash-low";
const AGY_BIN = process.env.AGY_BIN ?? "agy";
const PARALLEL = Math.max(1, Number(process.env.COMPARE_PARALLEL ?? 1));

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("-")) return args[i + 1];
  return undefined;
}

function runCheck(workdir: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["check.mjs"],
      { cwd: workdir, timeout: 30_000, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          exitCode: err ? 1 : 0,
          output: `${stdout ?? ""}${stderr ?? ""}`.slice(-1500),
        });
      },
    );
  });
}

function runAgy(workdir: string, prompt: string, timeoutMs: number): Promise<{
  ok: boolean;
  output: string;
  wallMs: number;
}> {
  const started = Date.now();
  return new Promise((resolve) => {
    const args = [
      "-p",
      prompt,
      "--add-dir",
      workdir,
      "--dangerously-skip-permissions",
      "--mode",
      "accept-edits",
      "--model",
      AGY_MODEL,
      "--print-timeout",
      `${Math.ceil(timeoutMs / 1000)}s`,
    ];
    execFile(
      AGY_BIN,
      args,
      {
        cwd: workdir,
        timeout: timeoutMs + 30_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env },
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          output: `${stdout ?? ""}\n${stderr ?? ""}`.slice(-4000),
          wallMs: Date.now() - started,
        });
      },
    );
  });
}

type Row = {
  id: string;
  harness: "clai" | "agy";
  status: "pass" | "fail" | "error";
  wallMs: number;
  detail?: string;
};

async function runAgyTask(task: Awaited<ReturnType<typeof loadBenchTasks>>[number]): Promise<Row> {
  const workdir = await mkdtemp(path.join(os.tmpdir(), `agy-bench-${task.id}-`));
  try {
    await cp(task.dir, workdir, {
      recursive: true,
      filter: (src) => {
        const name = path.basename(src);
        return name !== "_solution" && name !== "task.json";
      },
    });
    const agy = await runAgy(
      workdir,
      `${task.prompt}\n\nWork only inside this directory. When done, node check.mjs must exit 0.`,
      task.timeoutMs,
    );
    const check = await runCheck(workdir);
    if (check.exitCode === 0) {
      return { id: task.id, harness: "agy", status: "pass", wallMs: agy.wallMs };
    }
    if (!agy.ok && /quota|rate.?limit|429/i.test(agy.output)) {
      return {
        id: task.id,
        harness: "agy",
        status: "error",
        wallMs: agy.wallMs,
        detail: "rate limit / quota",
      };
    }
    return {
      id: task.id,
      harness: "agy",
      status: "fail",
      wallMs: agy.wallMs,
      detail: check.output.split("\n")[0],
    };
  } catch (err) {
    return {
      id: task.id,
      harness: "agy",
      status: "error",
      wallMs: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await rm(workdir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const ids = flagValue(args, "--tasks")?.split(",").map((s) => s.trim()).filter(Boolean);
  const fixturesRoot = resolveBenchFixturesRoot();
  const tasks = await loadBenchTasks(fixturesRoot, ids);

  console.log(`compare: ${tasks.length} tasks · agy model=${AGY_MODEL} · parallel=${PARALLEL}`);

  // agy pool
  const agyRows: Row[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      const task = tasks[i]!;
      process.stdout.write(`  agy  ${task.id}…\n`);
      agyRows[i] = await runAgyTask(task);
      console.log(
        `  agy  ${agyRows[i]!.status.toUpperCase().padEnd(5)} ${task.id} ${agyRows[i]!.wallMs}ms` +
          (agyRows[i]!.detail ? `  ${agyRows[i]!.detail}` : ""),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, tasks.length) }, worker));

  // CLAI: either fresh serial live run or latest history record
  let claiRows: Row[] = [];
  if (process.env.COMPARE_CLAI === "1") {
    console.log("  clai fresh live run (parallel=1)…");
    const record = await runBench({
      workspaceRoot: ROOT,
      tasks,
      parallel: 1,
      offline: false,
    });
    await new BenchStore(ROOT).appendRun(record);
    claiRows = record.tasks.map((t) => ({
      id: t.id,
      harness: "clai" as const,
      status: t.status === "pass" ? "pass" : t.status === "fail" ? "fail" : "error",
      wallMs: t.wallMs,
      detail: t.error?.slice(0, 120),
    }));
  } else {
    const store = new BenchStore(ROOT);
    const runs = await store.listRuns();
    const live = [...runs].reverse().find((r) => !r.offline && r.provider !== "offline");
    if (!live) {
      console.log("No prior live CLAI run in history — set COMPARE_CLAI=1 to run one.");
    } else {
      const full = await store.getRun(live.runId);
      console.log(`  clai from history ${live.runId}`);
      claiRows = (full?.tasks ?? []).map((t) => ({
        id: t.id,
        harness: "clai" as const,
        status: t.status === "pass" ? "pass" : t.status === "fail" ? "fail" : "error",
        wallMs: t.wallMs,
        detail: t.error?.slice(0, 120),
      }));
    }
  }

  const score = (rows: Row[]) => {
    const pass = rows.filter((r) => r.status === "pass").length;
    const fail = rows.filter((r) => r.status === "fail").length;
    const err = rows.filter((r) => r.status === "error").length;
    return { pass, fail, err, total: rows.length, rate: rows.length ? pass / rows.length : 0 };
  };

  const agyScore = score(agyRows);
  const claiScore = score(claiRows);

  console.log("\n=== scorecard ===");
  console.log(
    `agy  (${AGY_MODEL}):  ${agyScore.pass}/${agyScore.total} pass (${Math.round(agyScore.rate * 100)}%)  fail=${agyScore.fail} error=${agyScore.err}`,
  );
  if (claiRows.length) {
    console.log(
      `clai (history/live): ${claiScore.pass}/${claiScore.total} pass (${Math.round(claiScore.rate * 100)}%)  fail=${claiScore.fail} error=${claiScore.err}`,
    );
  }
  console.log("\nid                     clai    agy     notes");
  for (const t of tasks) {
    const c = claiRows.find((r) => r.id === t.id);
    const a = agyRows.find((r) => r.id === t.id)!;
    console.log(
      `${t.id.padEnd(22)} ${(c?.status ?? "—").padEnd(7)} ${a.status.padEnd(7)} ${(c?.detail || a.detail || "").slice(0, 60)}`,
    );
  }

  const outPath = path.join(ROOT, ".clai", "bench", "compare-agy.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        agyModel: AGY_MODEL,
        agy: agyRows,
        clai: claiRows,
        agyScore,
        claiScore,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nwrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
