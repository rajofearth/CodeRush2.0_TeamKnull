/**
 * compare-codex — run the same bench tasks on Codex (`codex exec`) and emit a
 * side-by-side scorecard vs CLAI (history by default; COMPARE_CLAI=1 for fresh).
 *
 * CLI-first (Option 2). Structured like compare-pi (`runCodex` / `runCodexTask`)
 * so jobs/dashboard can wire later without a rewrite.
 *
 * Usage:
 *   pnpm bench:compare-codex
 *   pnpm exec tsx src/bench/compare-codex.ts --tasks off-by-one,fix-broken-import
 *   COMPARE_CLAI=1 pnpm bench:compare-codex
 *
 * Defaults:
 *   CODEX_BIN=codex  CODEX_PROFILE=deepseek  CODEX_MODEL=deepseek-v4-flash
 *   COMPARE_PARALLEL=2  (DeepSeek stalls under load)
 *   COMPARE_CLAI unset → latest live CLAI history; COMPARE_CLAI=1 → fresh run
 *
 * Spawn (non-interactive):
 *   codex exec --profile <profile> -m <model> -C <workdir>
 *     --sandbox workspace-write -c approval_policy=never
 *     --skip-git-repo-check --ephemeral --json "<prompt>"
 *
 * Oracle: always `node check.mjs` after Codex exits (agent self-report ignored).
 * Usage: best-effort sum of `turn.completed.usage` from --json JSONL.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFiles } from "../adapter/env.js";
import { loadBenchTasks, resolveBenchFixturesRoot } from "./index.js";
import { estimateUsdBench } from "./pricing.js";
import { runBench } from "./runner.js";
import { BenchStore } from "./store.js";
import type { BenchTaskSpec } from "./types.js";

export const COMPARE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Extra wall after task.timeoutMs — process teardown padding. */
const CODEX_TIMEOUT_PAD_MS = 3_000;

export type CompareCodexRow = {
  id: string;
  harness: "clai" | "codex";
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

export type CompareCodexResult = {
  at: string;
  codexProfile: string;
  codexModel: string;
  codex: CompareCodexRow[];
  clai: CompareCodexRow[];
  codexScore: CompareScore;
  claiScore: CompareScore;
  claiLabel?: string;
};

export type RunCodexOptions = {
  profile: string;
  model: string;
  bin: string;
  signal?: AbortSignal;
  onSpawn?: (child: ChildProcess) => void;
};

function scoreRows(rows: CompareCodexRow[]): CompareScore {
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

/**
 * Resolve `codex` / `.cmd` / `.ps1` shims to `node` + `@openai/codex/bin/codex.js`
 * (same idea as resolvePiInvocation — avoids Windows shell quoting hazards).
 */
export function resolveCodexInvocation(codexBin: string): {
  command: string;
  prefixArgs: string[];
} {
  const candidates: string[] = [];
  if (path.isAbsolute(codexBin) && codexBin.endsWith(".js") && existsSync(codexBin)) {
    return { command: process.execPath, prefixArgs: [codexBin] };
  }
  if (
    codexBin === "codex" ||
    codexBin.endsWith(".cmd") ||
    codexBin.endsWith(".ps1") ||
    codexBin.endsWith("codex.js")
  ) {
    const localApp = process.env.LOCALAPPDATA ?? "";
    const appData = process.env.APPDATA ?? "";
    // Prefer npm global (upgrade path) over stale pnpm shims that may pin <0.144.
    candidates.push(
      path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js"),
      path.join(localApp, "pnpm", "global", "5", "node_modules", "@openai", "codex", "bin", "codex.js"),
      path.join(localApp, "pnpm", "global", "node_modules", "@openai", "codex", "bin", "codex.js"),
    );
    for (const c of candidates) {
      if (c && existsSync(c)) {
        return { command: process.execPath, prefixArgs: [c] };
      }
    }
  }
  return { command: codexBin, prefixArgs: [] };
}

type CodexUsageAcc = {
  tokensIn: number;
  tokensOut: number;
  textParts: string[];
  errors: string[];
};

function emptyCodexUsage(): CodexUsageAcc {
  return { tokensIn: 0, tokensOut: 0, textParts: [], errors: [] };
}

function addCodexUsage(acc: CodexUsageAcc, usage: unknown): void {
  if (!usage || typeof usage !== "object") return;
  const u = usage as Record<string, unknown>;
  // Official exec JSONL: turn.completed.usage.{input_tokens,output_tokens,…}
  const input =
    Number(u.input_tokens) ||
    Number(u.inputTokens) ||
    Number(u.input) ||
    0;
  const output =
    Number(u.output_tokens) ||
    Number(u.outputTokens) ||
    Number(u.output) ||
    0;
  // input_tokens is typically the full prompt volume; cached_* is a subset.
  if (input || output) {
    acc.tokensIn += input;
    acc.tokensOut += output;
    return;
  }
  // Fallback shapes (nested / alternate harness dumps)
  const nested = u.total_token_usage ?? u.totalTokenUsage ?? u.last_token_usage;
  if (nested && typeof nested === "object") {
    addCodexUsage(acc, nested);
  }
}

/** Parse `codex exec --json` JSONL: sum turn.completed usage; collect messages/errors. */
function ingestCodexJsonLine(acc: CodexUsageAcc, line: string): void {
  const t = line.trim().replace(/^\uFEFF/, "");
  if (!t.startsWith("{")) return;
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(t) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = typeof ev.type === "string" ? ev.type : "";
  if (type === "turn.completed" && ev.usage) {
    addCodexUsage(acc, ev.usage);
    return;
  }
  if (type === "turn.failed" || type === "error") {
    let msg = t.slice(0, 200);
    if (typeof ev.message === "string" && ev.message) {
      msg = ev.message;
    } else if (typeof ev.error === "string" && ev.error) {
      msg = ev.error;
    } else if (ev.error && typeof ev.error === "object") {
      const nested = (ev.error as { message?: unknown }).message;
      if (typeof nested === "string" && nested) msg = nested;
    }
    acc.errors.push(msg);
    return;
  }
  if (type === "item.completed" && ev.item && typeof ev.item === "object") {
    const item = ev.item as { type?: string; text?: string };
    if (item.type === "agent_message" && typeof item.text === "string" && item.text) {
      acc.textParts.push(item.text);
    }
  }
}

function truncateDetail(text: string, max = 800): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function killTree(child: ChildProcess): void {
  child.kill();
  if (child.pid && process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
}

export function runCodex(
  workdir: string,
  prompt: string,
  timeoutMs: number,
  opts: RunCodexOptions,
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
  const { command, prefixArgs } = resolveCodexInvocation(opts.bin);
  const limitMs = timeoutMs + CODEX_TIMEOUT_PAD_MS;
  const costProvider = "deepseek";

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

    // Flag order: profile/model, then -C, sandbox/policy, then --json, then prompt last.
    const args = [
      ...prefixArgs,
      "exec",
      "--profile",
      opts.profile,
      "-m",
      opts.model,
      "-C",
      workdir,
      "--sandbox",
      "workspace-write",
      "-c",
      "approval_policy=never",
      "--skip-git-repo-check",
      "--ephemeral",
      "--json",
      prompt,
    ];

    const child = spawn(command, args, {
      cwd: workdir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Prefer env_key in ~/.codex profile; still pass through for child.
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
      },
    });
    opts.onSpawn?.(child);

    let raw = "";
    let lineBuf = "";
    const usage = emptyCodexUsage();
    let settled = false;
    let stalled = false;
    let idleStalled = false;
    const stallMs = Math.max(
      5_000,
      Number(process.env.COMPARE_CODEX_STALL_MS ?? 20_000),
    );
    const idleMs = Math.max(
      5_000,
      Number(process.env.COMPARE_CODEX_IDLE_MS ?? 45_000),
    );
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (ok: boolean, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(stallTimer);
      if (idleTimer) clearTimeout(idleTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (lineBuf.trim()) ingestCodexJsonLine(usage, lineBuf);

      const tokensIn = usage.tokensIn;
      const tokensOut = usage.tokensOut;
      const cost = estimateUsdBench(costProvider, tokensIn, tokensOut);
      const textTail = usage.textParts.join("\n").slice(-2000);
      const errTail = usage.errors.join(" · ").slice(-800);
      const jsonLines = raw.split(/\r?\n/).filter((l) => l.trim().startsWith("{")).length;

      if (process.env.COMPARE_CODEX_DEBUG === "1") {
        console.error(
          `[codex-usage] jsonLines=${jsonLines} in=${tokensIn} out=${tokensOut}` +
            ` cost=${cost} raw=${raw.length}`,
        );
      }

      let output = errTail || textTail || raw.slice(-4000);
      if (idleStalled) {
        output = `idle stall · no stdout for ${idleMs}ms after JSON (hung mid-stream)`;
      } else if (stalled && !output.trim()) {
        output = `stall · 0 bytes after ${stallMs}ms (no codex JSON — hung / no output)`;
      } else if ((timedOut || stalled) && output.trim()) {
        output = `${output} · jsonLines=${jsonLines} raw=${raw.length}`;
      } else if (timedOut && !output.trim()) {
        output = `timed out · jsonLines=0 raw=0 (no codex JSON)`;
      }

      resolve({
        ok,
        timedOut: timedOut || stalled || idleStalled,
        output,
        wallMs: Date.now() - started,
        tokensIn,
        tokensOut,
        cost,
      });
    };

    let sawJsonStdout = false;
    const bumpIdle = () => {
      if (!sawJsonStdout || settled) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (settled) return;
        idleStalled = true;
        killTree(child);
        finish(false, true);
      }, idleMs);
    };

    const onAbort = () => {
      killTree(child);
      finish(false, false);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const onStdout = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (!sawJsonStdout && text.trim().startsWith("{")) {
        sawJsonStdout = true;
        clearTimeout(stallTimer);
      }
      raw += text;
      lineBuf += text;
      let nl: number;
      while ((nl = lineBuf.indexOf("\n")) >= 0) {
        ingestCodexJsonLine(usage, lineBuf.slice(0, nl));
        lineBuf = lineBuf.slice(nl + 1);
      }
      if (text.length) bumpIdle();
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
      killTree(child);
      finish(false, true);
    }, stallMs);

    const timer = setTimeout(() => {
      killTree(child);
      finish(false, true);
    }, limitMs);
  });
}

export async function runCodexTask(
  task: BenchTaskSpec,
  opts: RunCodexOptions,
): Promise<CompareCodexRow> {
  const workdir = await mkdtemp(path.join(os.tmpdir(), `codex-bench-${task.id}-`));
  try {
    await cp(task.dir, workdir, {
      recursive: true,
      filter: (src) => {
        const name = path.basename(src);
        return name !== "_solution" && name !== "task.json";
      },
    });
    const codex = await runCodex(
      workdir,
      `${task.prompt}\n\nWork only inside this directory. When done, node check.mjs must exit 0.`,
      task.timeoutMs,
      opts,
    );
    const usage = {
      tokensIn: codex.tokensIn,
      tokensOut: codex.tokensOut,
      cost: codex.cost,
    };
    if (opts.signal?.aborted) {
      return {
        id: task.id,
        harness: "codex",
        status: "error",
        wallMs: codex.wallMs,
        detail: "aborted",
        ...usage,
      };
    }
    if (codex.timedOut) {
      const empty = !codex.output.trim();
      return {
        id: task.id,
        harness: "codex",
        status: "error",
        wallMs: codex.wallMs,
        detail: truncateDetail(
          empty
            ? `timed out after ${codex.wallMs}ms · no codex JSON (hung / no output)`
            : codex.output.startsWith("stall") || codex.output.startsWith("idle")
              ? codex.output
              : `timed out after ${codex.wallMs}ms · ${codex.output.slice(-800)}`,
        ),
        ...usage,
      };
    }
    const check = await runCheck(workdir);
    if (check.exitCode === 0) {
      return {
        id: task.id,
        harness: "codex",
        status: "pass",
        wallMs: codex.wallMs,
        ...usage,
      };
    }
    if (
      !codex.ok &&
      /quota|rate.?limit|429|api.?key|unauthorized|401|profile|not found|unknown model/i.test(
        codex.output,
      )
    ) {
      return {
        id: task.id,
        harness: "codex",
        status: "error",
        wallMs: codex.wallMs,
        detail: truncateDetail(codex.output),
        ...usage,
      };
    }
    const checkLine = check.output.split("\n").find((l) => l.trim()) ?? "";
    const codexTail = codex.output.slice(-800);
    return {
      id: task.id,
      harness: "codex",
      status: "fail",
      wallMs: codex.wallMs,
      detail: truncateDetail(
        [checkLine, codexTail && `codex: ${codexTail}`].filter(Boolean).join(" · "),
      ),
      ...usage,
    };
  } catch (err) {
    return {
      id: task.id,
      harness: "codex",
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
): CompareCodexRow {
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

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("-")) return args[i + 1];
  return undefined;
}

async function main() {
  await loadEnvFiles();

  const profile = process.env.CODEX_PROFILE ?? "deepseek";
  const model = process.env.CODEX_MODEL ?? "deepseek-v4-flash";
  const bin = process.env.CODEX_BIN ?? "codex";
  const parallel = Math.max(1, Number(process.env.COMPARE_PARALLEL ?? 2));

  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn(
      "warn: DEEPSEEK_API_KEY is not set — Codex may still work if ~/.codex has another auth; prefer env_key=DEEPSEEK_API_KEY in the deepseek profile.",
    );
  }

  const args = process.argv.slice(2);
  const ids = flagValue(args, "--tasks")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fixturesRoot = resolveBenchFixturesRoot();
  const tasks = await loadBenchTasks(fixturesRoot, ids);
  if (!tasks.length) {
    throw new Error("No bench tasks to compare.");
  }

  const resolved = resolveCodexInvocation(bin);
  console.log(
    `compare: ${tasks.length} tasks · codex profile=${profile} model=${model} · parallel=${parallel}`,
  );
  console.log(
    `  spawn ${resolved.command === process.execPath ? "node" : resolved.command}` +
      `${resolved.prefixArgs.length ? ` ${path.basename(resolved.prefixArgs[0]!)}` : ""} exec …`,
  );

  const codexRows: CompareCodexRow[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      const task = tasks[i]!;
      process.stdout.write(`  codex ${task.id}…\n`);
      codexRows[i] = await runCodexTask(task, { profile, model, bin });
      const row = codexRows[i]!;
      console.log(
        `  codex ${row.status.toUpperCase().padEnd(5)} ${task.id} ${row.wallMs}ms` +
          `  tok=${(row.tokensIn || 0) + (row.tokensOut || 0)}` +
          `  $${Number(row.cost || 0).toFixed(4)}` +
          (row.detail ? `  ${row.detail.slice(0, 60)}` : ""),
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(parallel, tasks.length) }, () => worker()),
  );

  // CLAI: history by default (agy-style); COMPARE_CLAI=1 → fresh live run.
  let claiRows: CompareCodexRow[] = [];
  let claiLabel = "none";
  if (process.env.COMPARE_CLAI === "1" || process.env.COMPARE_CLAI === "true") {
    console.log("  clai fresh live run (parallel=1)…");
    const record = await runBench({
      workspaceRoot: COMPARE_ROOT,
      tasks,
      parallel: 1,
      offline: false,
    });
    await new BenchStore(COMPARE_ROOT).appendRun(record);
    claiRows = record.tasks.map((t) => taskResultToClaiRow(t, record.provider));
    claiLabel = `${record.runId} [${record.provider}/${record.model}] fresh`;
  } else {
    const store = new BenchStore(COMPARE_ROOT);
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
      console.log(
        "No prior live CLAI run in history — set COMPARE_CLAI=1 to run one.",
      );
      claiLabel = "none (fresh CLAI required)";
    } else {
      const full = await store.getRun(live.runId);
      const wanted = new Set(tasks.map((t) => t.id));
      claiRows = (full?.tasks ?? [])
        .filter((t) => wanted.has(t.id))
        .map((t) => taskResultToClaiRow(t, live.provider));
      claiLabel = `${live.runId} [${live.provider}/${live.model}] history`;
      console.log(`  clai from history ${live.runId}`);
    }
  }

  const codexScore = scoreRows(codexRows);
  const claiScore = scoreRows(claiRows);
  const result: CompareCodexResult = {
    at: new Date().toISOString(),
    codexProfile: profile,
    codexModel: model,
    codex: codexRows,
    clai: claiRows,
    codexScore,
    claiScore,
    claiLabel,
  };

  console.log("\n=== scorecard ===");
  console.log(
    `codex (${profile}/${model}):  ${codexScore.pass}/${codexScore.total} pass (${Math.round(codexScore.rate * 100)}%)  fail=${codexScore.fail} error=${codexScore.err}`,
  );
  if (claiRows.length) {
    console.log(
      `clai  (${claiLabel}): ${claiScore.pass}/${claiScore.total} pass (${Math.round(claiScore.rate * 100)}%)  fail=${claiScore.fail} error=${claiScore.err}`,
    );
  }
  console.log("\nid                     clai    codex   notes");
  for (const t of tasks) {
    const c = claiRows.find((r) => r.id === t.id);
    const x = codexRows.find((r) => r.id === t.id)!;
    console.log(
      `${t.id.padEnd(22)} ${(c?.status ?? "—").padEnd(7)} ${x.status.padEnd(7)} ${(c?.detail || x.detail || "").slice(0, 60)}`,
    );
  }

  const outDir = path.join(COMPARE_ROOT, ".clai", "bench");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "compare-codex.json");
  await writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`\nwrote ${outPath}`);
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
