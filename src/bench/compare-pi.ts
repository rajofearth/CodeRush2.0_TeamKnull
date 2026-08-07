/**
 * compare-pi — run the same 8-task bench against Pi (`pi`) on DeepSeek
 * and emit a side-by-side scorecard vs the latest CLAI live run (or a fresh
 * CLAI serial run if COMPARE_CLAI=1).
 *
 * Usage:
 *   pnpm exec tsx src/bench/compare-pi.ts
 *   pnpm exec tsx src/bench/compare-pi.ts --tasks off-by-one,fix-broken-import
 *   COMPARE_CLAI=1 pnpm exec tsx src/bench/compare-pi.ts
 *
 * Defaults match CLAI DeepSeek wiring:
 *   PI_PROVIDER=deepseek  PI_MODEL=deepseek-v4-flash
 *   DEEPSEEK_API_KEY from .env / environment
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

const PI_PROVIDER = process.env.PI_PROVIDER ?? "deepseek";
const PI_MODEL = process.env.PI_MODEL ?? "deepseek-v4-flash";
const PI_BIN = process.env.PI_BIN ?? "pi";
const PARALLEL = Math.max(1, Number(process.env.COMPARE_PARALLEL ?? 1));
/** Hard cap per pi task (pi print-mode hangs if stdin stays open). */
const PI_TIMEOUT_PAD_MS = 15_000;

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

function resolvePiInvocation(): { command: string; prefixArgs: string[] } {
  // Prefer invoking the JS entry directly so Windows doesn't need shell:true for .cmd.
  const roamingCli = path.join(
    process.env.APPDATA ?? "",
    "npm",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  if (
    (PI_BIN.endsWith(".cmd") || PI_BIN.endsWith(".ps1") || PI_BIN === "pi") &&
    existsSync(roamingCli)
  ) {
    return { command: process.execPath, prefixArgs: [roamingCli] };
  }
  return { command: PI_BIN, prefixArgs: [] };
}

function runPi(workdir: string, prompt: string, timeoutMs: number): Promise<{
  ok: boolean;
  timedOut: boolean;
  output: string;
  wallMs: number;
}> {
  const started = Date.now();
  const { command, prefixArgs } = resolvePiInvocation();
  const limitMs = timeoutMs + PI_TIMEOUT_PAD_MS;
  return new Promise((resolve) => {
    const args = [
      ...prefixArgs,
      "-p",
      "--provider",
      PI_PROVIDER,
      "--model",
      PI_MODEL,
      "--thinking",
      process.env.PI_THINKING ?? "off",
      "--no-session",
      "-a",
      prompt,
    ];
    if (process.env.DEEPSEEK_API_KEY) {
      args.splice(prefixArgs.length + 1, 0, "--api-key", process.env.DEEPSEEK_API_KEY);
    }

    // CRITICAL: stdin must be "ignore". Pi print-mode calls readPipedStdin() whenever
    // stdin is not a TTY and waits for EOF — an open execFile pipe hangs until timeout.
    const child = spawn(command, args, {
      cwd: workdir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
      },
    });

    let output = "";
    let settled = false;
    const finish = (ok: boolean, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok,
        timedOut,
        output: output.slice(-4000),
        wallMs: Date.now() - started,
      });
    };

    const onChunk = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      output += text;
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", (err) => {
      output += `\n${err.message}`;
      finish(false, false);
    });
    child.on("close", (code) => finish(code === 0, false));

    const timer = setTimeout(() => {
      child.kill();
      // Windows often needs a harder kill if the tree ignores SIGTERM.
      if (child.pid && process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
      }
      finish(false, true);
    }, limitMs);
  });
}

type Row = {
  id: string;
  harness: "clai" | "pi";
  status: "pass" | "fail" | "error";
  wallMs: number;
  detail?: string;
};

async function runPiTask(
  task: Awaited<ReturnType<typeof loadBenchTasks>>[number],
): Promise<Row> {
  const workdir = await mkdtemp(path.join(os.tmpdir(), `pi-bench-${task.id}-`));
  try {
    await cp(task.dir, workdir, {
      recursive: true,
      filter: (src) => {
        const name = path.basename(src);
        return name !== "_solution" && name !== "task.json";
      },
    });
    const pi = await runPi(
      workdir,
      `${task.prompt}\n\nWork only inside this directory. When done, node check.mjs must exit 0.`,
      task.timeoutMs,
    );
    if (pi.timedOut) {
      return {
        id: task.id,
        harness: "pi",
        status: "error",
        wallMs: pi.wallMs,
        detail: `timed out after ${pi.wallMs}ms`,
      };
    }
    const check = await runCheck(workdir);
    if (check.exitCode === 0) {
      return { id: task.id, harness: "pi", status: "pass", wallMs: pi.wallMs };
    }
    if (!pi.ok && /quota|rate.?limit|429|api.?key|unauthorized|401/i.test(pi.output)) {
      return {
        id: task.id,
        harness: "pi",
        status: "error",
        wallMs: pi.wallMs,
        detail: pi.output.split("\n").find((l) => l.trim())?.slice(0, 120) ?? "provider error",
      };
    }
    return {
      id: task.id,
      harness: "pi",
      status: "fail",
      wallMs: pi.wallMs,
      detail: check.output.split("\n")[0] || pi.output.split("\n").find((l) => l.trim())?.slice(0, 80),
    };
  } catch (err) {
    return {
      id: task.id,
      harness: "pi",
      status: "error",
      wallMs: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await rm(workdir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

async function loadClaiRows(
  tasks: Awaited<ReturnType<typeof loadBenchTasks>>,
): Promise<{ rows: Row[]; label: string }> {
  if (process.env.COMPARE_CLAI === "1") {
    console.log("  clai fresh live run (parallel=1)…");
    const record = await runBench({
      workspaceRoot: ROOT,
      tasks,
      parallel: 1,
      offline: false,
    });
    await new BenchStore(ROOT).appendRun(record);
    return {
      label: `${record.runId} [${record.provider}/${record.model}] fresh`,
      rows: record.tasks.map((t) => ({
        id: t.id,
        harness: "clai" as const,
        status: t.status === "pass" ? "pass" : t.status === "fail" ? "fail" : "error",
        wallMs: t.wallMs,
        detail: t.error?.slice(0, 120),
      })),
    };
  }

  const store = new BenchStore(ROOT);
  const runs = await store.listRuns();
  const live = [...runs]
    .reverse()
    .find(
      (r) =>
        !r.offline &&
        r.provider !== "offline" &&
        (r.provider === "deepseek" || !process.env.COMPARE_REQUIRE_DEEPSEEK),
    );
  if (!live) {
    return { rows: [], label: "none (set COMPARE_CLAI=1)" };
  }
  const full = await store.getRun(live.runId);
  return {
    label: `${live.runId} [${live.provider}/${live.model}] history`,
    rows: (full?.tasks ?? []).map((t) => ({
      id: t.id,
      harness: "clai" as const,
      status: t.status === "pass" ? "pass" : t.status === "fail" ? "fail" : "error",
      wallMs: t.wallMs,
      detail: t.error?.slice(0, 120),
    })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const ids = flagValue(args, "--tasks")?.split(",").map((s) => s.trim()).filter(Boolean);
  const fixturesRoot = resolveBenchFixturesRoot();
  const tasks = await loadBenchTasks(fixturesRoot, ids);

  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("DEEPSEEK_API_KEY is not set (expected in .env or environment).");
    process.exit(1);
  }

  // Load CLAI side first so the terminal shows both harnesses immediately.
  const clai = await loadClaiRows(tasks);
  const claiPass = clai.rows.filter((r) => r.status === "pass").length;
  console.log(
    `compare: ${tasks.length} tasks · parallel=${PARALLEL}\n` +
      `  clai  ${clai.label}` +
      (clai.rows.length ? `  ${claiPass}/${clai.rows.length} pass` : "") +
      `\n  pi    ${PI_PROVIDER}/${PI_MODEL}`,
  );

  const piRows: Row[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      const task = tasks[i]!;
      process.stdout.write(`  pi   ${task.id}…\n`);
      piRows[i] = await runPiTask(task);
      console.log(
        `  pi   ${piRows[i]!.status.toUpperCase().padEnd(5)} ${task.id} ${piRows[i]!.wallMs}ms` +
          (piRows[i]!.detail ? `  ${piRows[i]!.detail}` : ""),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, tasks.length) }, worker));

  const claiRows = clai.rows;

  const score = (rows: Row[]) => {
    const pass = rows.filter((r) => r.status === "pass").length;
    const fail = rows.filter((r) => r.status === "fail").length;
    const err = rows.filter((r) => r.status === "error").length;
    return { pass, fail, err, total: rows.length, rate: rows.length ? pass / rows.length : 0 };
  };

  const piScore = score(piRows);
  const claiScore = score(claiRows);

  console.log("\n=== scorecard ===");
  console.log(
    `pi   (${PI_PROVIDER}/${PI_MODEL}):  ${piScore.pass}/${piScore.total} pass (${Math.round(piScore.rate * 100)}%)  fail=${piScore.fail} error=${piScore.err}`,
  );
  if (claiRows.length) {
    console.log(
      `clai (${clai.label}): ${claiScore.pass}/${claiScore.total} pass (${Math.round(claiScore.rate * 100)}%)  fail=${claiScore.fail} error=${claiScore.err}`,
    );
  }
  console.log("\nid                     clai    pi      notes");
  for (const t of tasks) {
    const c = claiRows.find((r) => r.id === t.id);
    const p = piRows.find((r) => r.id === t.id)!;
    console.log(
      `${t.id.padEnd(22)} ${(c?.status ?? "—").padEnd(7)} ${p.status.padEnd(7)} ${(c?.detail || p.detail || "").slice(0, 60)}`,
    );
  }

  const outPath = path.join(ROOT, ".clai", "bench", "compare-pi.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        piProvider: PI_PROVIDER,
        piModel: PI_MODEL,
        pi: piRows,
        clai: claiRows,
        piScore,
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
