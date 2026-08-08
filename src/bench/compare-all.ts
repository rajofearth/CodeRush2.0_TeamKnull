/**
 * compare-all — race CLAI + pi + Codex on the same bench tasks, stream partial
 * scorecards, and persist a three-way CompareResult (mode: "all").
 *
 * Usage:
 *   pnpm bench:compare-all
 *   pnpm exec tsx src/bench/compare-all.ts --tasks off-by-one,fix-broken-import
 *
 * Defaults:
 *   fresh CLAI + pi + Codex in parallel
 *   PI_PROVIDER / PI_MODEL / PI_BIN — same as compare-pi
 *   CODEX_PROFILE=deepseek  CODEX_MODEL=deepseek-v4-flash  CODEX_BIN=codex
 *   COMPARE_PARALLEL=4 → sideParallel ≈ min(2, ceil(parallel/3))
 *
 * Requires DEEPSEEK_API_KEY (same as compare-pi).
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvFiles } from "../adapter/env.js";
import {
  COMPARE_ROOT,
  runPiTask,
  type CompareProgress,
  type CompareResult,
  type CompareRow,
  type CompareScore,
} from "./compare-pi.js";
import { runCodexTask, type CompareCodexRow } from "./compare-codex.js";
import { loadBenchTasks, resolveBenchFixturesRoot } from "./index.js";
import { estimateUsdBench } from "./pricing.js";
import { runBench } from "./runner.js";
import { BenchStore } from "./store.js";
import type { BenchTaskSpec, LiveSnapshot, LiveTask } from "./types.js";

/** Grace after Stop before finalize (don't wait forever on CLAI mid-tool). */
const STOP_GRACE_MS = 2_500;

export type RunCompareAllOptions = {
  workspaceRoot?: string;
  taskIds?: string[];
  freshClai?: boolean;
  parallel?: number;
  /** Workers per harness when racing; defaults to min(2, ceil(parallel/3)). */
  sideParallel?: number;
  signal?: AbortSignal;
  onProgress?: (progress: CompareProgress) => void;
};

function scoreRows(rows: CompareRow[]): CompareScore {
  const list = rows.filter(Boolean);
  const pass = list.filter((r) => r.status === "pass").length;
  const fail = list.filter((r) => r.status === "fail").length;
  const err = list.filter((r) => r.status === "error").length;
  return {
    pass,
    fail,
    err,
    total: list.length,
    rate: list.length ? pass / list.length : 0,
  };
}

function abortedRow(
  id: string,
  harness: CompareRow["harness"],
  detail = "aborted",
): CompareRow {
  return {
    id,
    harness,
    status: "error",
    wallMs: 0,
    detail,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
  };
}

function codexRowToCompareRow(row: CompareCodexRow): CompareRow {
  return {
    id: row.id,
    harness: "codex",
    status: row.status,
    wallMs: row.wallMs,
    detail: row.detail,
    tokensIn: Number(row.tokensIn) || 0,
    tokensOut: Number(row.tokensOut) || 0,
    cost: Number(row.cost) || 0,
  };
}

function taskResultToClaiRow(
  t: {
    id: string;
    status: string;
    wallMs: number;
    error?: string;
    tokensIn?: number;
    tokensOut?: number;
    cost?: number;
  },
  provider = "deepseek",
): CompareRow {
  const tokensIn = Number(t.tokensIn) || 0;
  const tokensOut = Number(t.tokensOut) || 0;
  return {
    id: t.id,
    harness: "clai",
    status: t.status === "pass" ? "pass" : t.status === "fail" ? "fail" : "error",
    wallMs: t.wallMs,
    detail: t.error?.slice(0, 120),
    tokensIn,
    tokensOut,
    cost: estimateUsdBench(provider, tokensIn, tokensOut),
  };
}

async function loadClaiFromHistory(
  workspaceRoot: string,
  tasks: BenchTaskSpec[],
): Promise<{ rows: CompareRow[]; label: string }> {
  const store = new BenchStore(workspaceRoot);
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
    return { rows: [], label: "none (fresh CLAI required)" };
  }
  const full = await store.getRun(live.runId);
  const wanted = new Set(tasks.map((t) => t.id));
  const rows = (full?.tasks ?? [])
    .filter((t) => wanted.has(t.id))
    .map((t) => taskResultToClaiRow(t, live.provider));
  return {
    label: `${live.runId} [${live.provider}/${live.model}] history`,
    rows,
  };
}

function statusRank(s: string): number {
  switch (s) {
    case "running":
      return 5;
    case "queued":
      return 4;
    case "error":
    case "timeout":
      return 3;
    case "fail":
      return 2;
    case "pass":
      return 1;
    default:
      return 0;
  }
}

function rowStatus(p: CompareRow | undefined, running: boolean): string {
  if (p) {
    return p.status === "pass" ? "pass" : p.status === "fail" ? "fail" : "error";
  }
  return running ? "running" : "queued";
}

/** Merge CLAI live + pi + codex rows for the Live panel. */
function buildCompareAllLiveSnapshot(
  tasks: BenchTaskSpec[],
  claiLive: LiveSnapshot | null,
  piRows: Array<CompareRow | undefined>,
  piRunning: Set<string>,
  codexRows: Array<CompareRow | undefined>,
  codexRunning: Set<string>,
  opts: {
    runId: string;
    startedAt: string;
    model: string;
    parallel: number;
    done: boolean;
  },
): LiveSnapshot {
  const claiById = new Map((claiLive?.tasks ?? []).map((t) => [t.id, t]));
  const liveTasks: LiveTask[] = tasks.map((t, i) => {
    const c = claiById.get(t.id);
    const p = piRows[i];
    const x = codexRows[i];
    const piStatus = rowStatus(p, piRunning.has(t.id));
    const codexStatus = rowStatus(x, codexRunning.has(t.id));
    const claiStatus = c?.status ?? "queued";
    let status: LiveTask["status"] = claiStatus;
    if (statusRank(piStatus) > statusRank(status)) {
      status = piStatus as LiveTask["status"];
    }
    if (statusRank(codexStatus) > statusRank(status)) {
      status = codexStatus as LiveTask["status"];
    }
    const steps =
      status === claiStatus &&
      (claiStatus === "running" || claiStatus === "pass" || claiStatus === "fail")
        ? c?.steps
        : undefined;
    const notes = [
      `clai=${claiStatus}`,
      `pi=${piStatus}`,
      `codex=${codexStatus}`,
      c?.error ? `claiErr=${c.error}` : "",
      p?.detail ? `piErr=${p.detail}` : "",
      x?.detail ? `codexErr=${x.detail}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const tokensIn =
      (Number(c?.tokensIn) || 0) +
      (Number(p?.tokensIn) || 0) +
      (Number(x?.tokensIn) || 0);
    const tokensOut =
      (Number(c?.tokensOut) || 0) +
      (Number(p?.tokensOut) || 0) +
      (Number(x?.tokensOut) || 0);
    const cost =
      (Number(c?.cost) || 0) + (Number(p?.cost) || 0) + (Number(x?.cost) || 0);
    const wallMs =
      Math.max(
        Number(c?.wallMs) || 0,
        Number(p?.wallMs) || 0,
        Number(x?.wallMs) || 0,
      ) || undefined;
    return {
      id: t.id,
      title: t.title,
      category: t.category,
      status: status as LiveTask["status"],
      wallMs,
      steps,
      tokensIn,
      tokensOut,
      cost,
      error: notes,
    };
  });
  return {
    runId: opts.runId,
    startedAt: opts.startedAt,
    provider: "clai+pi+codex",
    model: opts.model,
    offline: false,
    parallel: opts.parallel,
    tasks: liveTasks,
    done: opts.done,
    rateLimit: claiLive?.rateLimit,
  };
}

function buildCompareAllResult(opts: {
  claiRows: CompareRow[];
  piRows: CompareRow[];
  codexRows: CompareRow[];
  piProvider: string;
  piModel: string;
  codexProfile: string;
  codexModel: string;
  claiLabel?: string;
  partial?: boolean;
  stopped?: boolean;
  compareParallel: number;
  sideParallel: number;
  compareId?: string;
  claiRunId?: string;
}): CompareResult {
  return {
    at: new Date().toISOString(),
    mode: "all",
    piProvider: opts.piProvider,
    piModel: opts.piModel,
    pi: opts.piRows,
    clai: opts.claiRows,
    piScore: scoreRows(opts.piRows),
    claiScore: scoreRows(opts.claiRows),
    claiLabel: opts.claiLabel,
    codexProfile: opts.codexProfile,
    codexModel: opts.codexModel,
    codex: opts.codexRows,
    codexScore: scoreRows(opts.codexRows),
    compareId: opts.compareId,
    claiRunId: opts.claiRunId,
    compareParallel: opts.compareParallel,
    sideParallel: opts.sideParallel,
    partial: opts.partial || undefined,
    stopped: opts.stopped || undefined,
  };
}

function defaultFreshClai(optsFresh?: boolean): boolean {
  if (optsFresh != null) return optsFresh;
  if (process.env.COMPARE_CLAI === "0" || process.env.COMPARE_CLAI === "false") {
    return false;
  }
  return true;
}

function normalizeTokens(row: CompareRow): CompareRow {
  return {
    ...row,
    tokensIn: Number(row.tokensIn) || 0,
    tokensOut: Number(row.tokensOut) || 0,
    cost: Number(row.cost) || 0,
  };
}

/** Programmatic CLAI vs pi vs Codex compare (dashboard web compare + CLI). */
export async function runCompareAll(
  opts: RunCompareAllOptions = {},
): Promise<CompareResult> {
  const workspaceRoot = opts.workspaceRoot ?? COMPARE_ROOT;
  const piProvider = process.env.PI_PROVIDER ?? "deepseek";
  const piModel = process.env.PI_MODEL ?? "deepseek-v4-flash";
  const piBin = process.env.PI_BIN ?? "pi";
  const codexProfile = process.env.CODEX_PROFILE ?? "deepseek";
  const codexModel = process.env.CODEX_MODEL ?? "deepseek-v4-flash";
  const codexBin = process.env.CODEX_BIN ?? "codex";

  // DeepSeek races melt under high concurrency — default 4; split across 3 sides.
  const parallel = Math.max(
    1,
    opts.parallel ?? Number(process.env.COMPARE_PARALLEL ?? 4),
  );
  const freshClai = defaultFreshClai(opts.freshClai);
  const sideParallel =
    opts.sideParallel != null && Number.isFinite(opts.sideParallel)
      ? Math.max(1, Math.floor(Number(opts.sideParallel)))
      : freshClai
        ? Math.max(
            1,
            Math.min(
              parallel,
              Number(
                process.env.COMPARE_SIDE_PARALLEL ??
                  Math.min(2, Math.ceil(parallel / 3)),
              ),
            ),
          )
        : parallel;

  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not set (expected in .env or environment).");
  }

  const fixturesRoot = resolveBenchFixturesRoot();
  const tasks = await loadBenchTasks(fixturesRoot, opts.taskIds);
  if (!tasks.length) {
    throw new Error("No bench tasks to compare.");
  }

  const runId = `compare-all-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(16).slice(2, 10)}`;
  const startedAt = new Date().toISOString();

  let claiRows: CompareRow[] = [];
  let claiLabel = "pending";
  let claiRunId: string | undefined;
  let claiLive: LiveSnapshot | null = null;
  const piRows: Array<CompareRow | undefined> = new Array(tasks.length);
  const codexRows: Array<CompareRow | undefined> = new Array(tasks.length);
  const piRunning = new Set<string>();
  const codexRunning = new Set<string>();
  const activeChildren = new Set<ChildProcess>();

  const concurrency = { compareParallel: parallel, sideParallel };
  const compareIds = () => ({ compareId: runId, claiRunId });

  const emit = (phase: CompareProgress["phase"], done = false) => {
    const live = buildCompareAllLiveSnapshot(
      tasks,
      claiLive,
      piRows,
      piRunning,
      codexRows,
      codexRunning,
      {
        runId,
        startedAt,
        model: piModel,
        parallel: sideParallel,
        done,
      },
    );
    const compare = buildCompareAllResult({
      claiRows,
      piRows: piRows.filter(Boolean) as CompareRow[],
      codexRows: codexRows.filter(Boolean) as CompareRow[],
      piProvider,
      piModel,
      codexProfile,
      codexModel,
      claiLabel,
      partial: !done,
      ...concurrency,
      ...compareIds(),
    });
    opts.onProgress?.({
      phase,
      claiRows,
      piRows: piRows.filter(Boolean) as CompareRow[],
      codexRows: codexRows.filter(Boolean) as CompareRow[],
      claiLabel,
      live,
      compare,
    });
  };

  emit(freshClai ? "both" : "clai");

  const onAbort = () => {
    for (const child of activeChildren) {
      if (child.pid && process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } else {
        child.kill();
      }
    }
  };
  opts.signal?.addEventListener("abort", onAbort);

  const midPhase = (): CompareProgress["phase"] => (freshClai ? "both" : "pi");

  const runClaiSide = async () => {
    if (!freshClai) {
      const hist = await loadClaiFromHistory(workspaceRoot, tasks);
      claiRows = hist.rows;
      claiLabel = hist.label;
      claiRunId = /^(\S+)/.exec(hist.label)?.[1];
      emit("clai");
      return;
    }
    const record = await runBench({
      workspaceRoot,
      tasks,
      parallel: sideParallel,
      offline: false,
      signal: opts.signal,
      onUpdate: (snap) => {
        claiLive = snap;
        claiRows = snap.tasks
          .filter(
            (t) =>
              t.status === "pass" ||
              t.status === "fail" ||
              t.status === "error" ||
              t.status === "timeout",
          )
          .map((t) =>
            taskResultToClaiRow(
              {
                id: t.id,
                status: t.status,
                wallMs: t.wallMs ?? 0,
                error: t.error,
                tokensIn: t.tokensIn,
                tokensOut: t.tokensOut,
                cost: t.cost,
              },
              snap.provider,
            ),
          );
        claiLabel = `${snap.runId} [${snap.provider}/${snap.model}] fresh`;
        claiRunId = snap.runId;
        emit(midPhase());
      },
    });
    await new BenchStore(workspaceRoot).appendRun({
      ...record,
      kind: "clai",
      compareId: runId,
    });
    claiRows = record.tasks.map((t) => taskResultToClaiRow(t, record.provider));
    claiLabel = `${record.runId} [${record.provider}/${record.model}] fresh`;
    claiRunId = record.runId;
    claiLive = {
      runId: record.runId,
      startedAt: record.startedAt,
      provider: record.provider,
      model: record.model,
      offline: false,
      parallel: record.parallel,
      tasks: record.tasks.map((t, i) => ({
        id: t.id,
        title: tasks[i]?.title ?? t.id,
        category: tasks[i]?.category ?? "bugfix",
        status: t.status,
        wallMs: t.wallMs,
        steps: t.steps,
        tokensIn: Number(t.tokensIn) || 0,
        tokensOut: Number(t.tokensOut) || 0,
        cost: Number(t.cost) || 0,
        error: t.error,
      })),
      done: true,
    };
    emit(midPhase());
  };

  let piCircuitOpen = false;
  let codexCircuitOpen = false;

  const runPiSide = async () => {
    let next = 0;
    let pressureStreak = 0;
    const breaker = Math.max(
      1,
      Number(process.env.COMPARE_PI_STALL_BREAKER ?? 3),
    );
    const worker = async () => {
      while (next < tasks.length) {
        if (opts.signal?.aborted || piCircuitOpen) break;
        const i = next++;
        const task = tasks[i]!;
        piRunning.add(task.id);
        emit(midPhase());
        try {
          piRows[i] = await runPiTask(task, {
            provider: piProvider,
            model: piModel,
            bin: piBin,
            signal: opts.signal,
            onSpawn: (c) => {
              activeChildren.add(c);
              c.on("close", () => activeChildren.delete(c));
            },
          });
        } finally {
          piRunning.delete(task.id);
        }
        const row = piRows[i];
        const detail = row?.detail ?? "";
        const pressure =
          row?.status === "error" &&
          /stall|timed out|rate.?limit|429|hung|quota/i.test(detail);
        if (pressure) pressureStreak += 1;
        else if (row?.status === "pass" || row?.status === "fail") {
          pressureStreak = 0;
        }
        if (!opts.signal?.aborted && pressureStreak >= breaker) {
          piCircuitOpen = true;
          while (next < tasks.length) {
            const j = next++;
            if (!piRows[j]) {
              piRows[j] = abortedRow(
                tasks[j]!.id,
                "pi",
                `circuit breaker — ${breaker} consecutive pi stalls/timeouts`,
              );
            }
          }
        }
        emit(midPhase());
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(sideParallel, tasks.length) }, () => worker()),
    );
  };

  const runCodexSide = async () => {
    let next = 0;
    let pressureStreak = 0;
    const breaker = Math.max(
      1,
      Number(process.env.COMPARE_CODEX_STALL_BREAKER ?? 3),
    );
    const worker = async () => {
      while (next < tasks.length) {
        if (opts.signal?.aborted || codexCircuitOpen) break;
        const i = next++;
        const task = tasks[i]!;
        codexRunning.add(task.id);
        emit(midPhase());
        try {
          const row = await runCodexTask(task, {
            profile: codexProfile,
            model: codexModel,
            bin: codexBin,
            signal: opts.signal,
            onSpawn: (c) => {
              activeChildren.add(c);
              c.on("close", () => activeChildren.delete(c));
            },
          });
          codexRows[i] = codexRowToCompareRow(row);
        } finally {
          codexRunning.delete(task.id);
        }
        const row = codexRows[i];
        const detail = row?.detail ?? "";
        const pressure =
          row?.status === "error" &&
          /stall|timed out|rate.?limit|429|hung|quota/i.test(detail);
        if (pressure) pressureStreak += 1;
        else if (row?.status === "pass" || row?.status === "fail") {
          pressureStreak = 0;
        }
        if (!opts.signal?.aborted && pressureStreak >= breaker) {
          codexCircuitOpen = true;
          while (next < tasks.length) {
            const j = next++;
            if (!codexRows[j]) {
              codexRows[j] = abortedRow(
                tasks[j]!.id,
                "codex",
                `circuit breaker — ${breaker} consecutive codex stalls/timeouts`,
              );
            }
          }
        }
        emit(midPhase());
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(sideParallel, tasks.length) }, () => worker()),
    );
  };

  const abortGrace = (): Promise<void> =>
    new Promise((resolve) => {
      if (!opts.signal) return;
      const arm = () => setTimeout(resolve, STOP_GRACE_MS);
      if (opts.signal.aborted) arm();
      else opts.signal.addEventListener("abort", arm, { once: true });
    });

  try {
    await Promise.race([
      Promise.all([runClaiSide(), runPiSide(), runCodexSide()]),
      abortGrace(),
    ]);
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    onAbort();
  }

  const stopped = !!(
    opts.signal?.aborted ||
    piCircuitOpen ||
    codexCircuitOpen
  );
  const abortDetail = opts.signal?.aborted
    ? "aborted"
    : piCircuitOpen
      ? "circuit breaker — pi stalls"
      : codexCircuitOpen
        ? "circuit breaker — codex stalls"
        : "missing";

  const finalPi = tasks.map(
    (t, i) => piRows[i] ?? abortedRow(t.id, "pi", abortDetail),
  );
  const finalCodex = tasks.map(
    (t, i) => codexRows[i] ?? abortedRow(t.id, "codex", abortDetail),
  );
  const claiById = new Map(claiRows.filter(Boolean).map((r) => [r.id, r]));
  const finalClai = tasks.map((t) => {
    const existing = claiById.get(t.id);
    if (existing) return normalizeTokens(existing);
    return abortedRow(t.id, "clai", abortDetail);
  });

  const result = buildCompareAllResult({
    claiRows: finalClai,
    piRows: finalPi.map(normalizeTokens),
    codexRows: finalCodex.map(normalizeTokens),
    piProvider,
    piModel,
    codexProfile,
    codexModel,
    claiLabel,
    partial: false,
    stopped,
    ...concurrency,
    ...compareIds(),
  });

  const store = new BenchStore(workspaceRoot);
  await store.appendCompare(result);

  claiRows = result.clai;
  for (let i = 0; i < finalPi.length; i++) piRows[i] = result.pi[i];
  for (let i = 0; i < finalCodex.length; i++) {
    codexRows[i] = result.codex?.[i];
  }
  emit("done", true);

  return result;
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("-")) return args[i + 1];
  return undefined;
}

async function main() {
  await loadEnvFiles();
  const args = process.argv.slice(2);
  const ids = flagValue(args, "--tasks")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const parallel = Math.max(1, Number(process.env.COMPARE_PARALLEL ?? 4));
  let printedHeader = false;
  const seenPi = new Set<string>();
  const seenClai = new Set<string>();
  const seenCodex = new Set<string>();

  const result = await runCompareAll({
    taskIds: ids,
    parallel,
    onProgress: (p) => {
      if (!printedHeader) {
        printedHeader = true;
        const n = ids?.length || p.live?.tasks.length || 0;
        const side = p.live?.parallel ?? parallel;
        console.log(
          `compare-all: ${n} tasks · sideParallel=${side} (CLAI+pi+codex race)\n` +
            `  clai   ${p.claiLabel}\n` +
            `  pi     ${process.env.PI_PROVIDER ?? "deepseek"}/${process.env.PI_MODEL ?? "deepseek-v4-flash"}\n` +
            `  codex  ${process.env.CODEX_PROFILE ?? "deepseek"}/${process.env.CODEX_MODEL ?? "deepseek-v4-flash"}`,
        );
      }
      for (const row of p.claiRows) {
        if (!row.wallMs || seenClai.has(row.id)) continue;
        if (row.status !== "pass" && row.status !== "fail" && row.status !== "error") {
          continue;
        }
        seenClai.add(row.id);
        console.log(
          `  clai  ${row.status.toUpperCase().padEnd(5)} ${row.id} ${row.wallMs}ms` +
            `  tok=${(row.tokensIn || 0) + (row.tokensOut || 0)}` +
            `  $${Number(row.cost || 0).toFixed(4)}`,
        );
      }
      for (const row of p.piRows) {
        if (seenPi.has(row.id)) continue;
        seenPi.add(row.id);
        console.log(
          `  pi    ${row.status.toUpperCase().padEnd(5)} ${row.id} ${row.wallMs}ms` +
            `  tok=${(row.tokensIn || 0) + (row.tokensOut || 0)}` +
            `  $${Number(row.cost || 0).toFixed(4)}` +
            (row.detail ? `  ${row.detail.slice(0, 60)}` : ""),
        );
      }
      for (const row of p.codexRows ?? []) {
        if (seenCodex.has(row.id)) continue;
        seenCodex.add(row.id);
        console.log(
          `  codex ${row.status.toUpperCase().padEnd(5)} ${row.id} ${row.wallMs}ms` +
            `  tok=${(row.tokensIn || 0) + (row.tokensOut || 0)}` +
            `  $${Number(row.cost || 0).toFixed(4)}` +
            (row.detail ? `  ${row.detail.slice(0, 60)}` : ""),
        );
      }
    },
  });

  console.log(`\n=== scorecard ===`);
  console.log(
    `pi    (${result.piProvider}/${result.piModel}):  ${result.piScore.pass}/${result.piScore.total} pass (${Math.round(result.piScore.rate * 100)}%)  fail=${result.piScore.fail} error=${result.piScore.err}`,
  );
  if (result.codexScore) {
    console.log(
      `codex (${result.codexProfile}/${result.codexModel}): ${result.codexScore.pass}/${result.codexScore.total} pass (${Math.round(result.codexScore.rate * 100)}%)  fail=${result.codexScore.fail} error=${result.codexScore.err}`,
    );
  }
  if (result.clai.length) {
    console.log(
      `clai  (${result.claiLabel ?? "history"}): ${result.claiScore.pass}/${result.claiScore.total} pass (${Math.round(result.claiScore.rate * 100)}%)  fail=${result.claiScore.fail} error=${result.claiScore.err}`,
    );
  }
  console.log("\nid                     clai    pi      codex   notes");
  for (const p of result.pi) {
    const c = result.clai.find((r) => r.id === p.id);
    const x = result.codex?.find((r) => r.id === p.id);
    console.log(
      `${p.id.padEnd(22)} ${(c?.status ?? "—").padEnd(7)} ${p.status.padEnd(7)} ${(x?.status ?? "—").padEnd(7)} ${(c?.detail || p.detail || x?.detail || "").slice(0, 50)}`,
    );
  }
  console.log(
    `\nwrote ${path.join(COMPARE_ROOT, ".clai", "bench", "compares", `${result.compareId}.json`)}` +
      `\n  latest → ${path.join(COMPARE_ROOT, ".clai", "bench", "compare-pi.json")}` +
      `\n  copy   → ${path.join(COMPARE_ROOT, ".clai", "bench", "compare-all.json")}`,
  );
}

const entry = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
