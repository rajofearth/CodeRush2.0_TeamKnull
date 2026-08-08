/**
 * bench/runner — executes the benchmark task subset against the agent loop.
 *
 * For each task: copy the fixture to a temp work dir (fixtures are never
 * mutated), run the agent (or the scripted offline solver), run `node
 * check.mjs`, record metrics, clean up. Tasks run under a concurrency limit;
 * a crash or timeout in one task never kills the run.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAgentLoop, resolveModel, hasApiKey, type ResolvedModel } from "../adapter/index.js";
import { createSandbox } from "../sandbox/index.js";
import type { ToolContext } from "../tools/index.js";
import { createTraceWriter } from "../trace/index.js";
import { estimateUsdBench } from "./pricing.js";
import {
  computeAggregates,
  type BenchRunRecord,
  type BenchTaskSpec,
  type LiveSnapshot,
  type LiveTask,
  type TaskResult,
} from "./types.js";

const CHECK_TIMEOUT_MS = 30_000;

export type BenchRunnerOptions = {
  /** Where `.clai/bench` (traces, history) lives — usually the CLAI repo root. */
  workspaceRoot: string;
  tasks: BenchTaskSpec[];
  parallel?: number;
  offline?: boolean;
  /** Stop workers, cancel retries, and abort in-flight model calls. */
  signal?: AbortSignal;
  /** Called with a fresh snapshot after every state change (for SSE / TUI). */
  onUpdate?: (snapshot: LiveSnapshot) => void;
};

export async function loadBenchTasks(
  fixturesRoot: string,
  ids?: string[],
): Promise<BenchTaskSpec[]> {
  const entries = await readdir(fixturesRoot, { withFileTypes: true });
  const tasks: BenchTaskSpec[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(fixturesRoot, entry.name);
    let spec: Record<string, unknown>;
    try {
      spec = JSON.parse(await readFile(path.join(dir, "task.json"), "utf8"));
    } catch {
      continue; // not a task dir
    }
    tasks.push({
      id: String(spec.id ?? entry.name),
      title: String(spec.title ?? entry.name),
      prompt: String(spec.prompt ?? ""),
      category: (spec.category as BenchTaskSpec["category"]) ?? "bugfix",
      timeoutMs: Number(spec.timeoutMs ?? 120_000),
      maxSteps: Number(spec.maxSteps ?? 10),
      dir,
    });
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id));
  if (ids && ids.length > 0) {
    const want = new Set(ids);
    const filtered = tasks.filter((t) => want.has(t.id));
    const missing = ids.filter((id) => !filtered.some((t) => t.id === id));
    if (missing.length > 0) {
      throw new Error(`unknown bench task id(s): ${missing.join(", ")}`);
    }
    return filtered;
  }
  return tasks;
}

export async function runBench(
  opts: BenchRunnerOptions,
): Promise<BenchRunRecord> {
  const runId = `bench-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const parallel = Math.max(1, opts.parallel ?? 3);
  const offline = opts.offline ?? false;

  let model: ResolvedModel | undefined;
  let provider = "offline";
  let modelId = "scripted-solver";
  if (!offline) {
    if (!hasApiKey()) {
      throw new Error(
        "no provider API key found — set GROQ_API_KEY (or another provider) or use --offline",
      );
    }
    model = await resolveModel();
    provider = model.provider;
    modelId = model.modelId;
  }

  const live: LiveTask[] = opts.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category,
    status: "queued",
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
  }));
  let done = false;
  let rateLimit: LiveSnapshot["rateLimit"] = null;
  const snapshot = (): LiveSnapshot => ({
    runId,
    startedAt,
    provider,
    model: modelId,
    offline,
    parallel,
    tasks: live.map((t) => ({ ...t })),
    done,
    rateLimit,
  });
  const publish = () => opts.onUpdate?.(snapshot());
  publish();

  const results: TaskResult[] = new Array(opts.tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < opts.tasks.length) {
      if (opts.signal?.aborted) break;
      const index = next++;
      const task = opts.tasks[index]!;
      const liveTask = live[index]!;
      liveTask.status = "running";
      rateLimit = null;
      publish();
      const result = await runOneTask(task, {
        runId,
        workspaceRoot: opts.workspaceRoot,
        offline,
        model,
        provider,
        signal: opts.signal,
        onProgress: (partial) => {
          if (partial.tokensIn != null) {
            liveTask.tokensIn = Number(partial.tokensIn) || 0;
          }
          if (partial.tokensOut != null) {
            liveTask.tokensOut = Number(partial.tokensOut) || 0;
          }
          if (partial.cost != null) {
            const c = Number(partial.cost);
            liveTask.cost = Number.isFinite(c) ? c : 0;
          }
          if (partial.status) liveTask.status = partial.status;
          if (partial.steps != null) liveTask.steps = partial.steps;
          if (partial.wallMs != null) liveTask.wallMs = partial.wallMs;
          if (partial.error !== undefined) liveTask.error = partial.error;
          publish();
        },
        onRateLimit: (info) => {
          rateLimit = { ...info, taskId: task.id };
          publish();
        },
      });
      results[index] = result;
      liveTask.status = result.status;
      liveTask.wallMs = result.wallMs;
      liveTask.steps = result.steps;
      liveTask.tokensIn = Number(result.tokensIn) || 0;
      liveTask.tokensOut = Number(result.tokensOut) || 0;
      liveTask.cost = Number.isFinite(Number(result.cost)) ? Number(result.cost) : 0;
      liveTask.error = result.error;
      if (result.status !== "error" || !/rate.?limit|quota/i.test(result.error ?? "")) {
        rateLimit = null;
      }
      publish();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(parallel, opts.tasks.length) }, worker),
  );

  // Mark tasks never started (or still queued) after Stop / abort.
  for (let i = 0; i < opts.tasks.length; i++) {
    if (results[i]) continue;
    const task = opts.tasks[i]!;
    const liveTask = live[i]!;
    const aborted: TaskResult = {
      id: task.id,
      title: task.title,
      category: task.category,
      status: "error",
      wallMs: 0,
      steps: 0,
      toolCalls: {},
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      error: "aborted",
    };
    results[i] = aborted;
    liveTask.status = "error";
    liveTask.error = "aborted";
  }

  done = true;
  rateLimit = null;
  publish();

  return {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    provider,
    model: modelId,
    offline,
    parallel,
    taskIds: opts.tasks.map((t) => t.id),
    tasks: results,
    aggregates: computeAggregates(results),
  };
}

type TaskRunContext = {
  runId: string;
  workspaceRoot: string;
  offline: boolean;
  model?: ResolvedModel;
  provider: string;
  signal?: AbortSignal;
  onProgress: (partial: Partial<LiveTask>) => void;
  onRateLimit?: (info: {
    label: string;
    detail?: string;
    retryInSec?: number;
  }) => void;
};

async function runOneTask(
  task: BenchTaskSpec,
  ctx: TaskRunContext,
): Promise<TaskResult> {
  const started = Date.now();
  const base: TaskResult = {
    id: task.id,
    title: task.title,
    category: task.category,
    status: "error",
    wallMs: 0,
    steps: 0,
    toolCalls: {},
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
  };

  let workdir: string | undefined;
  try {
    workdir = await mkdtemp(path.join(os.tmpdir(), `clai-bench-${task.id}-`));
    await copyFixture(task.dir, workdir);

    if (ctx.offline) {
      await offlineSolve(task, workdir, base);
    } else {
      await agentSolve(task, workdir, ctx, base);
    }

    // Stop must be snappy — skip check.mjs after abort (can take up to 30s).
    const aborted =
      ctx.signal?.aborted ||
      base.error === "aborted" ||
      base.status === "error" && /aborted/i.test(base.error ?? "");
    if (aborted) {
      base.status = "error";
      base.error = "aborted";
    } else {
      const check = await runCheck(workdir);
      base.checkExitCode = check.exitCode;
      base.checkOutput = check.output.slice(-2000);
      if (base.status !== "timeout" && base.status !== "error") {
        base.status = check.exitCode === 0 ? "pass" : "fail";
      } else if (check.exitCode === 0) {
        // Agent timed out / crashed but had already fixed the code — count it.
        base.status = "pass";
      }
      if (base.status === "pass") {
        // Don't leave a recovered 429 note hanging on a green task.
        base.error = undefined;
      }
    }
    base.tokensIn = Number(base.tokensIn) || 0;
    base.tokensOut = Number(base.tokensOut) || 0;
    base.cost = Number.isFinite(Number(base.cost)) ? Number(base.cost) : 0;
  } catch (err) {
    const aborted =
      ctx.signal?.aborted ||
      (err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message)));
    base.status = "error";
    base.error = aborted
      ? "aborted"
      : err instanceof Error
        ? err.message
        : String(err);
  } finally {
    if (workdir) {
      await rm(workdir, { recursive: true, force: true, maxRetries: 3 }).catch(
        () => {},
      );
    }
  }

  base.wallMs = Date.now() - started;
  return base;
}

/** Copy the fixture, excluding the reference solution and the task manifest. */
async function copyFixture(fixtureDir: string, dest: string): Promise<void> {
  await cp(fixtureDir, dest, {
    recursive: true,
    filter: (src) => {
      const name = path.basename(src);
      return name !== "_solution" && name !== "task.json";
    },
  });
}

/**
 * Scripted solver for `--offline` smoke runs: overlays `_solution/` onto the
 * workdir when present so the check pipeline is testable without an API key.
 * Tasks without a reference solution are left broken (honest fail).
 */
async function offlineSolve(
  task: BenchTaskSpec,
  workdir: string,
  out: TaskResult,
): Promise<void> {
  out.status = "fail"; // provisional; check decides
  const solutionDir = path.join(task.dir, "_solution");
  try {
    await access(solutionDir);
  } catch {
    out.error = undefined;
    out.checkOutput =
      "offline solver has no _solution/ for this task (expected fail)";
    return;
  }
  await cp(solutionDir, workdir, { recursive: true, force: true });
  out.steps = 1;
  out.toolCalls = { patch: 1 };
}

async function agentSolve(
  task: BenchTaskSpec,
  workdir: string,
  ctx: TaskRunContext,
  out: TaskResult,
): Promise<void> {
  const trace = await createTraceWriter({
    runId: `${ctx.runId}-${task.id}`,
    dir: path.join(
      ctx.workspaceRoot,
      ".clai",
      "bench",
      "traces",
      ctx.runId,
      task.id,
    ),
    cwd: workdir,
  });
  out.tracePath = trace.path;

  // Bench must not use seatbelt — stub avoids EPERM on node check.mjs writes
  // under parallel workers (matches devices where stub already wins).
  const sandbox = await createSandbox({
    workspaceRoot: workdir,
    autoApprove: true,
    forceStub: true,
  });

  let benchCheckPassed = false;
  const checkAbort = new AbortController();
  const onParentAbort = () => checkAbort.abort();
  if (ctx.signal?.aborted) {
    checkAbort.abort();
  } else {
    ctx.signal?.addEventListener("abort", onParentAbort);
  }

  const toolCtx: ToolContext = {
    workspaceRoot: workdir,
    sandbox,
    trace,
    benchDenyCheckRead: true,
    onEvent: (event) => {
      if (event.type === "tool_call") {
        out.toolCalls[event.tool] = (out.toolCalls[event.tool] ?? 0) + 1;
      }
    },
    onBenchCheckPass: () => {
      benchCheckPassed = true;
      // Abort synchronously so the agent loop cannot start another provider
      // round (setTimeout(0) raced the next streamText and hung ~150s).
      checkAbort.abort();
    },
  };

  const timedOut = Symbol("timeout");
  const checkPassed = Symbol("check-pass");
  let timer: NodeJS.Timeout | undefined;

  // Workspace inventory (bench-only) — avoids glob and often skips reading check.mjs.
  let workspaceFiles: string[] = [];
  try {
    workspaceFiles = (await readdir(workdir))
      .filter(
        (n) =>
          !n.startsWith(".") &&
          n !== "task.json" &&
          n !== "_solution" &&
          n !== "node_modules",
      )
      .sort();
  } catch {
    workspaceFiles = [];
  }
  const fileList = workspaceFiles.length
    ? workspaceFiles.filter((n) => n !== "check.mjs").join(", ") || "(none)"
    : "(unknown)";
  // Keep short: task.prompt already says verify with node check.mjs.
  const BENCH_SYSTEM = `Coding bench. Files: ${fileList}.
Read/edit those (SPEC.md only if mentioned). Never read check.mjs — use bash stderr from node check.mjs instead.
Flow: read → edit/write → bash {command:"node check.mjs"}; stop on exit 0. Multiple reads in one step OK.`;
  try {
    const loopPromise = runAgentLoop({
      ctx: toolCtx,
      prompt: task.prompt,
      maxSteps: Math.max(1, task.maxSteps || 10),
      model: ctx.model,
      system: BENCH_SYSTEM,
      replaceSystem: true,
      toolProfile: "coding",
      trace,
      signal: checkAbort.signal,
      onStatus: (status) => {
        const isRateLimit = /quota|rate.?limit|waiting \d+s|provider hiccup|rate limited/i.test(
          status.label,
        );
        if (isRateLimit) {
          const m = /waiting (\d+)s/.exec(status.label);
          ctx.onRateLimit?.({
            label: status.label,
            detail: status.detail,
            retryInSec: m ? Number(m[1]) : undefined,
          });
        }
        ctx.onProgress({
          error: status.level === "error" ? status.label : undefined,
        });
      },
      onUsage: (usage) => {
        const tokensIn = Number(usage.promptTokens) || 0;
        const tokensOut = Number(usage.completionTokens) || 0;
        out.tokensIn = tokensIn;
        out.tokensOut = tokensOut;
        // Same tokens→$ mapping as compare-pi (no cache-hit discount).
        out.cost = estimateUsdBench(ctx.provider, tokensIn, tokensOut);
        ctx.onProgress({
          tokensIn: out.tokensIn,
          tokensOut: out.tokensOut,
          cost: out.cost,
        });
      },
    }).catch((err) => {
      // Early stop after check.mjs pass aborts the loop — treat as normal end.
      if (benchCheckPassed) {
        return {
          text: "",
          finishReason: "check-pass",
          steps: out.steps || 0,
          messages: [],
        };
      }
      throw err;
    });
    const aborted = Symbol("abort");
    const raced = await Promise.race([
      loopPromise,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), task.timeoutMs);
      }),
      new Promise<typeof aborted>((resolve) => {
        if (ctx.signal?.aborted) {
          resolve(aborted);
          return;
        }
        ctx.signal?.addEventListener(
          "abort",
          () => resolve(aborted),
          { once: true },
        );
      }),
      // Don't wait on a hung post-check provider stream — resolve as soon as
      // check.mjs passes (loopPromise may still be draining in the background).
      new Promise<typeof checkPassed>((resolve) => {
        if (benchCheckPassed || checkAbort.signal.aborted) {
          if (benchCheckPassed) resolve(checkPassed);
          return;
        }
        checkAbort.signal.addEventListener(
          "abort",
          () => {
            if (benchCheckPassed) resolve(checkPassed);
          },
          { once: true },
        );
      }),
    ]);
    if (raced === timedOut) {
      checkAbort.abort();
      out.status = "timeout";
      out.error = `agent exceeded ${task.timeoutMs}ms`;
      await trace.close("timeout");
    } else if (raced === checkPassed) {
      out.steps = out.steps || 0;
      out.status = "fail"; // provisional; check decides
      out.error = undefined;
      await trace.close("ok", { finishReason: "check-pass" });
    } else if (raced === aborted) {
      if (benchCheckPassed) {
        out.steps = out.steps || 0;
        out.status = "fail"; // provisional; check decides
        out.error = undefined;
        await trace.close("ok", { finishReason: "check-pass" });
      } else {
        out.status = "error";
        out.error = "aborted";
        await trace.close("error", { message: "aborted" });
      }
    } else {
      out.steps = raced.steps;
      out.status = "fail"; // provisional; check decides
      out.error = undefined; // clear transient rate-limit notes if we recovered
      await trace.close("ok", { finishReason: raced.finishReason });
    }
  } catch (err) {
    if (benchCheckPassed) {
      out.status = "fail"; // provisional; outer check decides
      out.steps = out.steps || 0;
      out.error = undefined;
      await trace.close("ok", { finishReason: "check-pass" }).catch(() => {});
    } else {
      const isAbort =
        ctx.signal?.aborted ||
        checkAbort.signal.aborted ||
        (err instanceof Error &&
          (err.name === "AbortError" || /aborted/i.test(err.message)));
      out.status = "error";
      out.error = isAbort
        ? "aborted"
        : err instanceof Error
          ? err.message
          : String(err);
      await trace.close("error", { message: out.error }).catch(() => {});
    }
  } finally {
    ctx.signal?.removeEventListener("abort", onParentAbort);
    if (timer) clearTimeout(timer);
    await sandbox.dispose().catch(() => {});
  }
}

function runCheck(
  workdir: string,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["check.mjs"],
      { cwd: workdir, timeout: CHECK_TIMEOUT_MS, windowsHide: true },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number"
            ? Number((err as { code: number }).code)
            : err
              ? 1
              : 0;
        resolve({ exitCode: code, output: `${stdout ?? ""}${stderr ?? ""}` });
      },
    );
  });
}
