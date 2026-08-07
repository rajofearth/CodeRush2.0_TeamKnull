/**
 * bench/jobs — in-process job runner for the dashboard control center.
 * Starts CLAI / offline / compare jobs, pushes LiveRunFeed + compare SSE.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFiles } from "../adapter/env.js";
import { runComparePi, type CompareResult } from "./compare-pi.js";
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
    tasks?: string[];
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
    tasks?: string[];
    freshClai?: boolean;
  }) => {
    await loadEnvFiles();
    const fixturesRoot = resolveBenchFixturesRoot();
    const tasks = await loadBenchTasks(fixturesRoot, req.tasks);
    if (!tasks.length) {
      throw new Error("No bench tasks to run.");
    }

    if (req.kind === "compare") {
      await runComparePi({
        workspaceRoot: opts.workspaceRoot,
        taskIds: req.tasks,
        parallel: req.parallel ?? 8,
        freshClai: req.freshClai ?? true,
        signal: abort?.signal,
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
      onUpdate: (snap) => opts.live.update(snap),
    });
    await opts.store.appendRun(record);
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
        publishCompare({
          at: new Date().toISOString(),
          piProvider: process.env.PI_PROVIDER ?? "deepseek",
          piModel: process.env.PI_MODEL ?? "deepseek-v4-flash",
          pi: [],
          clai: [],
          piScore: { pass: 0, fail: 0, err: 0, total: 0, rate: 0 },
          claiScore: { pass: 0, fail: 0, err: 0, total: 0, rate: 0 },
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
        .then(() => finish())
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
            finish(err instanceof Error ? err.message : String(err));
          })();
        });
      return { ok: true as const };
    },
    stop: () => {
      if (current.status !== "running" || !abort) {
        return { ok: false as const, error: "no running job" };
      }
      setStatus({ ...current, status: "stopping" });
      abort.abort();
      return { ok: true as const };
    },
  };
}
