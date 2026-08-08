/**
 * bench/jobs — in-process job runner for the dashboard control center.
 * Starts CLAI / offline / compare jobs, pushes LiveRunFeed + compare SSE.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFiles } from "../adapter/env.js";
import { runCompareAll } from "./compare-all.js";
import type { CompareResult } from "./compare-pi.js";
import { loadBenchTasks, resolveBenchFixturesRoot } from "./index.js";
import { runBench } from "./runner.js";
import type { BenchStore, LiveRunFeed } from "./store.js";

export type JobKind = "clai" | "offline" | "compare";

export type JobStatus = {
  status: "idle" | "running" | "stopping";
  kind?: JobKind;
  startedAt?: string;
  error?: string;
};

export type JobManager = {
  status: () => JobStatus;
  start: (req: {
    kind: JobKind;
    parallel?: number;
    /** Compare only: workers per harness (overrides split-of-parallel default). */
    sideParallel?: number;
    tasks?: string[];
    /** Take the first N catalog tasks (after optional tasks filter). */
    limit?: number;
    freshClai?: boolean;
  }) => { ok: true } | { ok: false; status: number; error: string };
  stop: () => { ok: true } | { ok: false; error: string };
  getCompare: () => CompareResult | null;
  onCompare: (listener: (compare: CompareResult | null) => void) => () => void;
  onStatus: (listener: (status: JobStatus) => void) => () => void;
};

export function createJobManager(opts: {
  workspaceRoot: string;
  store: BenchStore;
  live: LiveRunFeed;
}): JobManager {
  let current: JobStatus = { status: "idle" };
  let abort: AbortController | null = null;
  let latestCompare: CompareResult | null = null;
  const compareListeners = new Set<(compare: CompareResult | null) => void>();
  const statusListeners = new Set<(status: JobStatus) => void>();

  const publishCompare = (c: CompareResult | null) => {
    latestCompare = c;
    for (const l of compareListeners) {
      try {
        l(c);
      } catch {
        /* ignore */
      }
    }
  };

  const setStatus = (s: JobStatus) => {
    current = s;
    for (const l of statusListeners) {
      try {
        l(s);
      } catch {
        /* ignore */
      }
    }
  };

  const finish = (error?: string) => {
    setStatus({
      status: "idle",
      kind: current.kind,
      startedAt: current.startedAt,
      error,
    });
    abort = null;
  };

  const run = async (req: {
    kind: JobKind;
    parallel?: number;
    sideParallel?: number;
    tasks?: string[];
    limit?: number;
    freshClai?: boolean;
  }) => {
    await loadEnvFiles();
    const fixturesRoot = resolveBenchFixturesRoot();
    let tasks = await loadBenchTasks(fixturesRoot, req.tasks);
    if (req.limit != null && Number.isFinite(req.limit) && req.limit > 0) {
      tasks = tasks.slice(0, Math.floor(req.limit));
    }
    if (!tasks.length) {
      throw new Error("No bench tasks to run.");
    }
    const taskIds = tasks.map((t) => t.id);
    const signal = abort?.signal;

    if (req.kind === "compare") {
      // Web compare races CLAI + pi + Codex (three-way).
      await runCompareAll({
        workspaceRoot: opts.workspaceRoot,
        taskIds,
        parallel: req.parallel ?? 4,
        sideParallel: req.sideParallel,
        freshClai: req.freshClai ?? true,
        signal,
        onProgress: (p) => {
          if (p.live) opts.live.update(p.live);
          if (p.compare) publishCompare(p.compare);
        },
      });
      return;
    }

    const offline = req.kind === "offline";
    const parallel = req.parallel ?? (offline ? 3 : 1);
    const record = await runBench({
      workspaceRoot: opts.workspaceRoot,
      tasks,
      parallel,
      offline,
      signal,
      onUpdate: (snap) => opts.live.update(snap),
    });
    await opts.store.appendRun({
      ...record,
      kind: offline ? "offline" : "clai",
    });
  };

  return {
    status: () => ({ ...current }),
    getCompare: () => latestCompare,
    onCompare: (listener) => {
      compareListeners.add(listener);
      return () => compareListeners.delete(listener);
    },
    onStatus: (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    start: (req) => {
      if (current.status === "running" || current.status === "stopping") {
        return {
          ok: false as const,
          status: 409,
          error: `job already ${current.status} (${current.kind})`,
        };
      }
      if (req.kind !== "clai" && req.kind !== "offline" && req.kind !== "compare") {
        return { ok: false as const, status: 400, error: "invalid kind" };
      }
      abort = new AbortController();
      // Snapshot last finished card, then seed partial so reconnects never flash
      // the previous winner while the new race is starting.
      const restoreCompare =
        req.kind === "compare" && latestCompare && latestCompare.partial !== true
          ? latestCompare
          : null;
      if (req.kind === "compare") {
        const zeroScore = { pass: 0, fail: 0, err: 0, total: 0, rate: 0 };
        publishCompare({
          at: new Date().toISOString(),
          mode: "all",
          piProvider: process.env.PI_PROVIDER ?? "deepseek",
          piModel: process.env.PI_MODEL ?? "deepseek-v4-flash",
          pi: [],
          clai: [],
          codex: [],
          piScore: { ...zeroScore },
          claiScore: { ...zeroScore },
          codexScore: { ...zeroScore },
          codexProfile: process.env.CODEX_PROFILE ?? "deepseek",
          codexModel: process.env.CODEX_MODEL ?? "deepseek-v4-flash",
          claiLabel: "starting…",
          partial: true,
        });
      }
      setStatus({
        status: "running",
        kind: req.kind,
        startedAt: new Date().toISOString(),
      });
      void run(req)
        .then(() => {
          const stopped = abort?.signal.aborted;
          finish(stopped ? "stopped by user" : undefined);
        })
        .catch((err) => {
          void (async () => {
            // Failed before a finished scorecard — don't leave SSE on empty seed.
            if (req.kind === "compare" && latestCompare?.partial === true) {
              if (restoreCompare) {
                publishCompare(restoreCompare);
              } else {
                try {
                  const diskPath = path.join(
                    opts.workspaceRoot,
                    ".clai",
                    "bench",
                    "compare-pi.json",
                  );
                  publishCompare(
                    JSON.parse(await readFile(diskPath, "utf8")) as CompareResult,
                  );
                } catch {
                  publishCompare(null);
                }
              }
            }
            const msg = err instanceof Error ? err.message : String(err);
            const stopped =
              abort?.signal.aborted ||
              (err instanceof Error && err.name === "AbortError") ||
              /aborted/i.test(msg);
            finish(stopped ? "stopped by user" : msg);
          })();
        });
      return { ok: true as const };
    },
    stop: () => {
      if (
        !abort ||
        (current.status !== "running" && current.status !== "stopping")
      ) {
        return { ok: false as const, error: "no running job" };
      }
      if (current.status === "running") {
        setStatus({ ...current, status: "stopping" });
      }
      abort.abort();
      return { ok: true as const };
    },
  };
}
