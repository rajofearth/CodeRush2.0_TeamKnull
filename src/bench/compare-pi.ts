/**
 * compare-pi — run the same bench tasks on CLAI and Pi (same model), then
 * emit a side-by-side scorecard with wall time, tokens, and cost.
 *
 * Usage:
 *   pnpm exec tsx src/bench/compare-pi.ts
 *   pnpm exec tsx src/bench/compare-pi.ts --tasks off-by-one,fix-broken-import
 *   COMPARE_CLAI=0 pnpm exec tsx src/bench/compare-pi.ts   # history CLAI only
 *
 * Defaults:
 *   fresh CLAI + pi in parallel; COMPARE_PARALLEL=8 means sideParallel=4 each
 *   (peak ~8 in-flight). Override with COMPARE_SIDE_PARALLEL.
 *   PI_PROVIDER=deepseek  PI_MODEL=deepseek-v4-flash
 *
 * Pi tokens: `--mode json` sums `message_end` usage
 * (input+cacheRead+cacheWrite / output). Cost uses estimateUsdBench —
 * all tokensIn × inputPerM + tokensOut × outputPerM (no cache-hit discount).
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFiles } from "../adapter/env.js";
import { loadBenchTasks, resolveBenchFixturesRoot } from "./index.js";
import { estimateUsdBench } from "./pricing.js";
import { runBench } from "./runner.js";
import { BenchStore } from "./store.js";
import type { BenchTaskSpec, LiveSnapshot, LiveTask } from "./types.js";

export const COMPARE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export type CompareRow = {
  id: string;
  harness: "clai" | "pi";
  status: "pass" | "fail" | "error";
  wallMs: number;
  detail?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
};

export type CompareScore = {
  pass: number;
  fail: number;
  err: number;
  total: number;
  rate: number;
};

export type CompareResult = {
  at: string;
  piProvider: string;
  piModel: string;
  pi: CompareRow[];
  clai: CompareRow[];
  piScore: CompareScore;
  claiScore: CompareScore;
  claiLabel?: string;
  /** Requested COMPARE_PARALLEL (before race split). */
  compareParallel?: number;
  /** Effective per-harness worker count during the race. */
  sideParallel?: number;
  /**
   * True while either harness is still running. Dashboard keeps the task table
   * live but freezes winner/composite until this is false (phase "done").
   */
  partial?: boolean;
};

export type CompareProgress = {
  /** "both" = fresh CLAI + pi in parallel; "clai"/"pi" = single-side updates; "done" = final. */
  phase: "clai" | "pi" | "both" | "done";
  claiRows: CompareRow[];
  piRows: CompareRow[];
  claiLabel: string;
  /** Synthetic live snapshot for the dashboard Live panel (both harnesses). */
  live?: LiveSnapshot;
  compare?: CompareResult;
};

export type RunComparePiOptions = {
  workspaceRoot?: string;
  taskIds?: string[];
  freshClai?: boolean;
  parallel?: number;
  signal?: AbortSignal;
  onProgress?: (progress: CompareProgress) => void;
};

const PI_TIMEOUT_PAD_MS = 15_000;

function scoreRows(rows: CompareRow[]): CompareScore {
  const pass = rows.filter((r) => r.status === "pass").length;
  const fail = rows.filter((r) => r.status === "fail").length;
  const err = rows.filter((r) => r.status === "error").length;
  return {
    pass,
    fail,
    err,
    total: rows.length,
    rate: rows.length ? pass / rows.length : 0,
  };
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

function resolvePiInvocation(piBin: string): { command: string; prefixArgs: string[] } {
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
    (piBin.endsWith(".cmd") || piBin.endsWith(".ps1") || piBin === "pi") &&
    existsSync(roamingCli)
  ) {
    return { command: process.execPath, prefixArgs: [roamingCli] };
  }
  return { command: piBin, prefixArgs: [] };
}

type PiUsageAcc = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  tokensOut: number;
  textParts: string[];
};

function emptyPiUsage(): PiUsageAcc {
  return { input: 0, cacheRead: 0, cacheWrite: 0, tokensOut: 0, textParts: [] };
}

function addPiUsage(acc: PiUsageAcc, usage: unknown): void {
  if (!usage || typeof usage !== "object") return;
  const u = usage as Record<string, unknown>;
  acc.input += Number(u.input) || 0;
  acc.cacheRead += Number(u.cacheRead) || 0;
  acc.cacheWrite += Number(u.cacheWrite) || 0;
  acc.tokensOut += Number(u.output) || 0;
}

function piUsageTotals(acc: PiUsageAcc, provider: string) {
  // tokensIn keeps the full prompt volume (miss + cache read/write) for display.
  // Cache splits stay on `acc` for COMPARE_PI_DEBUG; dollars ignore cache rates.
  const tokensIn = acc.input + acc.cacheRead + acc.cacheWrite;
  const tokensOut = acc.tokensOut;
  const cost = estimateUsdBench(provider, tokensIn, tokensOut);
  return { tokensIn, tokensOut, cost };
}

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { role?: string; content?: unknown };
  if (m.role !== "assistant") return "";
  const content = m.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const b = block as { type?: string; text?: string };
      return b.type === "text" && typeof b.text === "string" ? b.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Parse pi `--mode json` stdout: sum usage from message_end (authoritative). */
function ingestPiJsonLine(acc: PiUsageAcc, line: string): void {
  const t = line.trim().replace(/^\uFEFF/, "");
  if (!t.startsWith("{")) return;
  let ev: { type?: string; message?: unknown };
  try {
    ev = JSON.parse(t) as { type?: string; message?: unknown };
  } catch {
    return;
  }
  if (ev.type !== "message_end" || !ev.message || typeof ev.message !== "object") return;
  const msg = ev.message as { role?: string; usage?: unknown };
  if (msg.role === "assistant" || msg.role === "toolResult") {
    addPiUsage(acc, msg.usage);
  }
  const text = extractAssistantText(msg);
  if (text) acc.textParts.push(text);
}

function runPi(
  workdir: string,
  prompt: string,
  timeoutMs: number,
  opts: {
    provider: string;
    model: string;
    bin: string;
    signal?: AbortSignal;
    onSpawn?: (child: ChildProcess) => void;
  },
): Promise<{
  ok: boolean;
  timedOut: boolean;
  output: string;
  wallMs: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}> {
  const started = Date.now();
  const { command, prefixArgs } = resolvePiInvocation(opts.bin);
  const limitMs = timeoutMs + PI_TIMEOUT_PAD_MS;
  return new Promise((resolve) => {
    if (opts.signal?.aborted) {
      resolve({
        ok: false,
        timedOut: false,
        output: "aborted",
        wallMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
      });
      return;
    }
    // --mode json streams native usage on message_end (print -p has no telemetry).
    // Extensions (pi-tps / pi-token-usage / pi-otel) are interactive overlays on the same data.
    // Build flags then prompt — never splice between a flag and its value.
    const args = [
      ...prefixArgs,
      "--mode",
      "json",
      "--provider",
      opts.provider,
      "--model",
      opts.model,
      "--no-session",
      "-a",
    ];
    // Only pass --thinking when explicitly set — defaulting to "off" hurts quality.
    if (process.env.PI_THINKING) {
      args.push("--thinking", process.env.PI_THINKING);
    }
    if (process.env.DEEPSEEK_API_KEY) {
      args.push("--api-key", process.env.DEEPSEEK_API_KEY);
    }
    args.push(prompt);

    const child = spawn(command, args, {
      cwd: workdir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
        // Keep bench runs offline from Aspire/OTLP unless the user opted in.
        PI_OTEL_DISABLED: process.env.PI_OTEL_DISABLED ?? "1",
      },
    });
    opts.onSpawn?.(child);

    let raw = "";
    let lineBuf = "";
    const usage = emptyPiUsage();
    let settled = false;
    let stalled = false;
    const stallMs = Math.max(
      10_000,
      Number(process.env.COMPARE_PI_STALL_MS ?? 45_000),
    );
    const finish = (ok: boolean, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(stallTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (lineBuf.trim()) ingestPiJsonLine(usage, lineBuf);
      const totals = piUsageTotals(usage, opts.provider);
      const textTail = usage.textParts.join("\n").slice(-2000);
      const jsonLines = raw.split(/\r?\n/).filter((l) => l.trim().startsWith("{")).length;
      if (process.env.COMPARE_PI_DEBUG === "1") {
        const safeArgs = args.map((a, i) =>
          args[i - 1] === "--api-key" ? "***" : a.length > 80 ? `${a.slice(0, 77)}…` : a,
        );
        console.error(
          `[pi-usage] jsonLines=${jsonLines} in=${totals.tokensIn} out=${totals.tokensOut}` +
            ` cost=${totals.cost} (miss=${usage.input} cacheRead=${usage.cacheRead}` +
            ` cacheWrite=${usage.cacheWrite}) raw=${raw.length}`,
        );
        console.error(`[pi-usage] argv=${JSON.stringify(safeArgs)}`);
      }
      let output = textTail || raw.slice(-4000);
      if (stalled && !output.trim()) {
        output = `stall · 0 bytes after ${stallMs}ms (no pi JSON — hung or rate-limited)`;
      } else if ((timedOut || stalled) && output.trim()) {
        output = `${output} · jsonLines=${jsonLines} raw=${raw.length}`;
      } else if (timedOut && !output.trim()) {
        output = `timed out · jsonLines=0 raw=0 (no pi JSON)`;
      }
      resolve({
        ok,
        timedOut: timedOut || stalled,
        output,
        wallMs: Date.now() - started,
        tokensIn: totals.tokensIn,
        tokensOut: totals.tokensOut,
        cost: totals.cost,
      });
    };

    const killTree = () => {
      child.kill();
      if (child.pid && process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
      }
    };

    const onAbort = () => {
      killTree();
      finish(false, false);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    let sawJsonStdout = false;
    const onStdout = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      // Stall kill keys off JSON stdout only — stderr/otel noise must not cancel it.
      if (!sawJsonStdout && text.trim().startsWith("{")) {
        sawJsonStdout = true;
        clearTimeout(stallTimer);
      }
      raw += text;
      lineBuf += text;
      let nl: number;
      while ((nl = lineBuf.indexOf("\n")) >= 0) {
        ingestPiJsonLine(usage, lineBuf.slice(0, nl));
        lineBuf = lineBuf.slice(nl + 1);
      }
    };
    const onStderr = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      raw += text;
    };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("error", (err) => {
      raw += `\n${err.message}`;
      finish(false, false);
    });
    child.on("close", (code) => finish(code === 0, false));

    const stallTimer = setTimeout(() => {
      if (settled || sawJsonStdout) return;
      stalled = true;
      killTree();
      finish(false, true);
    }, stallMs);

    const timer = setTimeout(() => {
      killTree();
      finish(false, true);
    }, limitMs);
  });
}

function truncateDetail(text: string, max = 800): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

async function runPiTask(
  task: BenchTaskSpec,
  opts: {
    provider: string;
    model: string;
    bin: string;
    signal?: AbortSignal;
    onSpawn?: (child: ChildProcess) => void;
  },
): Promise<CompareRow> {
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
      opts,
    );
    const usage = {
      tokensIn: pi.tokensIn,
      tokensOut: pi.tokensOut,
      cost: pi.cost,
    };
    if (opts.signal?.aborted) {
      return {
        id: task.id,
        harness: "pi",
        status: "error",
        wallMs: pi.wallMs,
        detail: "aborted",
        ...usage,
      };
    }
    if (pi.timedOut) {
      const empty = !pi.output.trim();
      return {
        id: task.id,
        harness: "pi",
        status: "error",
        wallMs: pi.wallMs,
        detail: truncateDetail(
          empty
            ? `timed out after ${pi.wallMs}ms · no pi JSON (hung / rate-limited)`
            : pi.output.startsWith("stall")
              ? pi.output
              : `timed out after ${pi.wallMs}ms · ${pi.output.slice(-800)}`,
        ),
        ...usage,
      };
    }
    const check = await runCheck(workdir);
    if (check.exitCode === 0) {
      return {
        id: task.id,
        harness: "pi",
        status: "pass",
        wallMs: pi.wallMs,
        ...usage,
      };
    }
    if (!pi.ok && /quota|rate.?limit|429|api.?key|unauthorized|401/i.test(pi.output)) {
      return {
        id: task.id,
        harness: "pi",
        status: "error",
        wallMs: pi.wallMs,
        detail: truncateDetail(pi.output),
        ...usage,
      };
    }
    const checkLine = check.output.split("\n").find((l) => l.trim()) ?? "";
    const piTail = pi.output.slice(-800);
    return {
      id: task.id,
      harness: "pi",
      status: "fail",
      wallMs: pi.wallMs,
      detail: truncateDetail(
        [checkLine, piTail && `pi: ${piTail}`].filter(Boolean).join(" · "),
      ),
      ...usage,
    };
  } catch (err) {
    return {
      id: task.id,
      harness: "pi",
      status: "error",
      wallMs: 0,
      detail: err instanceof Error ? err.message : String(err),
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
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
    // Same estimateUsdBench path as pi (all tokensIn × inputPerM).
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

/** Merge CLAI live feed + pi rows so the Live panel shows both harnesses. */
function buildCompareLiveSnapshot(
  tasks: BenchTaskSpec[],
  claiLive: LiveSnapshot | null,
  piRows: Array<CompareRow | undefined>,
  piRunning: Set<string>,
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
    const piStatus = p
      ? p.status === "pass"
        ? "pass"
        : p.status === "fail"
          ? "fail"
          : "error"
      : piRunning.has(t.id)
        ? "running"
        : "queued";
    const claiStatus = c?.status ?? "queued";
    const status =
      statusRank(claiStatus) >= statusRank(piStatus) ? claiStatus : piStatus;
    // Never attach CLAI step counts to a pi-driven error/running card.
    const steps =
      status === claiStatus && (claiStatus === "running" || claiStatus === "pass" || claiStatus === "fail")
        ? c?.steps
        : undefined;
    const notes = [
      `clai=${claiStatus}`,
      `pi=${piStatus}`,
      c?.error ? `claiErr=${c.error}` : "",
      p?.detail ? `piErr=${p.detail}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const tokensIn = (Number(c?.tokensIn) || 0) + (Number(p?.tokensIn) || 0);
    const tokensOut = (Number(c?.tokensOut) || 0) + (Number(p?.tokensOut) || 0);
    const cost = (Number(c?.cost) || 0) + (Number(p?.cost) || 0);
    const wallMs = Math.max(Number(c?.wallMs) || 0, Number(p?.wallMs) || 0) || undefined;
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
    provider: "clai+pi",
    model: opts.model,
    offline: false,
    parallel: opts.parallel,
    tasks: liveTasks,
    done: opts.done,
    rateLimit: claiLive?.rateLimit,
  };
}

function buildCompareResult(
  claiRows: CompareRow[],
  piRows: CompareRow[],
  provider: string,
  model: string,
  claiLabel?: string,
  partial = false,
  concurrency?: { compareParallel: number; sideParallel: number },
): CompareResult {
  return {
    at: new Date().toISOString(),
    piProvider: provider,
    piModel: model,
    pi: piRows,
    clai: claiRows,
    piScore: scoreRows(piRows),
    claiScore: scoreRows(claiRows),
    claiLabel,
    compareParallel: concurrency?.compareParallel,
    sideParallel: concurrency?.sideParallel,
    partial: partial || undefined,
  };
}

function defaultFreshClai(optsFresh?: boolean): boolean {
  if (optsFresh != null) return optsFresh;
  // COMPARE_CLAI=0 → history only; unset/1 → fresh (default).
  if (process.env.COMPARE_CLAI === "0" || process.env.COMPARE_CLAI === "false") {
    return false;
  }
  return true;
}

/** Programmatic CLAI vs pi compare (used by CLI and dashboard jobs). */
export async function runComparePi(
  opts: RunComparePiOptions = {},
): Promise<CompareResult> {
  const workspaceRoot = opts.workspaceRoot ?? COMPARE_ROOT;
  const provider = process.env.PI_PROVIDER ?? "deepseek";
  const model = process.env.PI_MODEL ?? "deepseek-v4-flash";
  const bin = process.env.PI_BIN ?? "pi";
  const parallel = Math.max(
    1,
    opts.parallel ?? Number(process.env.COMPARE_PARALLEL ?? 8),
  );
  const freshClai = defaultFreshClai(opts.freshClai);
  // Racing both harnesses at full parallel doubles API load (e.g. 8+8=16) and
  // DeepSeek stalls pi with zero JSON until task timeout. Split concurrency.
  const sideParallel = freshClai
    ? Math.max(
        1,
        Math.min(
          parallel,
          Number(process.env.COMPARE_SIDE_PARALLEL ?? Math.ceil(parallel / 2)),
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

  const runId = `compare-pi-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(16).slice(2, 10)}`;
  const startedAt = new Date().toISOString();

  let claiRows: CompareRow[] = [];
  let claiLabel = "pending";
  let claiLive: LiveSnapshot | null = null;
  const piRows: Array<CompareRow | undefined> = new Array(tasks.length);
  const piRunning = new Set<string>();
  const activeChildren = new Set<ChildProcess>();

  const concurrency = { compareParallel: parallel, sideParallel };

  const emit = (phase: CompareProgress["phase"], done = false) => {
    const live = buildCompareLiveSnapshot(tasks, claiLive, piRows, piRunning, {
      runId,
      startedAt,
      model,
      parallel: sideParallel,
      done,
    });
    // Always publish compare rows for the live task table; mark partial so the
    // dashboard freezes winner/composite until both harnesses finish.
    const compare = buildCompareResult(
      claiRows,
      piRows.filter(Boolean) as CompareRow[],
      provider,
      model,
      claiLabel,
      !done,
      concurrency,
    );
    opts.onProgress?.({
      phase,
      claiRows,
      piRows: piRows.filter(Boolean) as CompareRow[],
      claiLabel,
      live,
      compare,
    });
  };

  // Mid-run phase: "both" when fresh CLAI + pi race; else history CLAI then pi.
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
      emit("clai");
      return;
    }
    const record = await runBench({
      workspaceRoot,
      tasks,
      parallel: sideParallel,
      offline: false,
      onUpdate: (snap) => {
        claiLive = snap;
        // Only finished tasks enter the scorecard (queued/running ≠ error).
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
        emit(midPhase());
      },
    });
    await new BenchStore(workspaceRoot).appendRun(record);
    claiRows = record.tasks.map((t) => taskResultToClaiRow(t, record.provider));
    claiLabel = `${record.runId} [${record.provider}/${record.model}] fresh`;
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

  const runPiSide = async () => {
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        if (opts.signal?.aborted) break;
        const i = next++;
        const task = tasks[i]!;
        piRunning.add(task.id);
        emit(midPhase());
        try {
          piRows[i] = await runPiTask(task, {
            provider,
            model,
            bin,
            signal: opts.signal,
            onSpawn: (c) => {
              activeChildren.add(c);
              c.on("close", () => activeChildren.delete(c));
            },
          });
        } finally {
          piRunning.delete(task.id);
        }
        emit(midPhase());
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(sideParallel, tasks.length) }, () => worker()),
    );
  };

  try {
    // Both harnesses start immediately, each capped at sideParallel workers.
    await Promise.all([runClaiSide(), runPiSide()]);
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }

  const finalPi = piRows.map(
    (r, i) =>
      r ??
      ({
        id: tasks[i]!.id,
        harness: "pi" as const,
        status: "error" as const,
        wallMs: 0,
        detail: "aborted",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
      }),
  );
  // Ensure token fields are always present in the scorecard JSON.
  const finalClai = claiRows.map((r) => ({
    ...r,
    tokensIn: Number(r.tokensIn) || 0,
    tokensOut: Number(r.tokensOut) || 0,
    cost: Number(r.cost) || 0,
  }));
  const result = buildCompareResult(
    finalClai,
    finalPi.map((r) => ({
      ...r,
      tokensIn: Number(r.tokensIn) || 0,
      tokensOut: Number(r.tokensOut) || 0,
      cost: Number(r.cost) || 0,
    })),
    provider,
    model,
    claiLabel,
    false,
    concurrency,
  );

  const outPath = path.join(workspaceRoot, ".clai", "bench", "compare-pi.json");
  await writeFile(outPath, JSON.stringify(result, null, 2), "utf8");

  claiRows = result.clai;
  for (let i = 0; i < finalPi.length; i++) piRows[i] = result.pi[i];
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
  const parallel = Math.max(1, Number(process.env.COMPARE_PARALLEL ?? 8));
  let printedHeader = false;
  const seenPi = new Set<string>();
  const seenClai = new Set<string>();

  const result = await runComparePi({
    taskIds: ids,
    parallel,
    onProgress: (p) => {
      if (!printedHeader) {
        printedHeader = true;
        const n = ids?.length || p.live?.tasks.length || 0;
        const side = p.live?.parallel ?? parallel;
        console.log(
          `compare: ${n} tasks · sideParallel=${side} (CLAI+pi race) · fresh CLAI + pi together\n` +
            `  clai  ${p.claiLabel}\n` +
            `  pi    ${process.env.PI_PROVIDER ?? "deepseek"}/${process.env.PI_MODEL ?? "deepseek-v4-flash"}`,
        );
      }
      for (const row of p.claiRows) {
        if (!row.wallMs || seenClai.has(row.id)) continue;
        if (row.status !== "pass" && row.status !== "fail" && row.status !== "error") {
          continue;
        }
        seenClai.add(row.id);
        console.log(
          `  clai ${row.status.toUpperCase().padEnd(5)} ${row.id} ${row.wallMs}ms` +
            `  tok=${(row.tokensIn || 0) + (row.tokensOut || 0)}` +
            `  $${Number(row.cost || 0).toFixed(4)}`,
        );
      }
      for (const row of p.piRows) {
        if (seenPi.has(row.id)) continue;
        seenPi.add(row.id);
        console.log(
          `  pi   ${row.status.toUpperCase().padEnd(5)} ${row.id} ${row.wallMs}ms` +
            `  tok=${(row.tokensIn || 0) + (row.tokensOut || 0)}` +
            `  $${Number(row.cost || 0).toFixed(4)}` +
            (row.detail ? `  ${row.detail.slice(0, 60)}` : ""),
        );
      }
    },
  });

  console.log(`\n=== scorecard ===`);
  console.log(
    `pi   (${result.piProvider}/${result.piModel}):  ${result.piScore.pass}/${result.piScore.total} pass (${Math.round(result.piScore.rate * 100)}%)  fail=${result.piScore.fail} error=${result.piScore.err}`,
  );
  if (result.clai.length) {
    console.log(
      `clai (${result.claiLabel ?? "history"}): ${result.claiScore.pass}/${result.claiScore.total} pass (${Math.round(result.claiScore.rate * 100)}%)  fail=${result.claiScore.fail} error=${result.claiScore.err}`,
    );
  }
  console.log("\nid                     clai    pi      notes");
  for (const p of result.pi) {
    const c = result.clai.find((r) => r.id === p.id);
    console.log(
      `${p.id.padEnd(22)} ${(c?.status ?? "—").padEnd(7)} ${p.status.padEnd(7)} ${(c?.detail || p.detail || "").slice(0, 60)}`,
    );
  }
  console.log(`\nwrote ${path.join(COMPARE_ROOT, ".clai", "bench", "compare-pi.json")}`);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
