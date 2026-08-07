/**
 * bench/store — append-only run history + full run detail + live feed.
 *
 * Layout under `<workspaceRoot>/.clai/bench/`:
 *   history.jsonl        one compact line per completed run
 *   runs/<runId>.json    full BenchRunRecord detail
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BenchRunRecord, LiveSnapshot } from "./types.js";

/** Compact per-run summary — one history.jsonl line. */
export type BenchRunSummary = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  provider: string;
  model: string;
  offline: boolean;
  parallel: number;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  timedOut: number;
  passRate: number;
  totalWallMs: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  tasks: Array<{ id: string; status: string; wallMs: number }>;
};

export class BenchStore {
  readonly benchDir: string;
  readonly historyPath: string;
  readonly runsDir: string;

  constructor(workspaceRoot: string) {
    this.benchDir = path.join(workspaceRoot, ".clai", "bench");
    this.historyPath = path.join(this.benchDir, "history.jsonl");
    this.runsDir = path.join(this.benchDir, "runs");
  }

  async appendRun(record: BenchRunRecord): Promise<void> {
    await mkdir(this.runsDir, { recursive: true });
    await writeFile(
      path.join(this.runsDir, `${record.runId}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
    const summary = toSummary(record);
    await appendFile(this.historyPath, `${JSON.stringify(summary)}\n`, "utf8");
  }

  /** All run summaries, oldest first. Tolerates a corrupt trailing line. */
  async listRuns(): Promise<BenchRunSummary[]> {
    let raw: string;
    try {
      raw = await readFile(this.historyPath, "utf8");
    } catch {
      return [];
    }
    const runs: BenchRunSummary[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        runs.push(JSON.parse(line) as BenchRunSummary);
      } catch {
        /* skip corrupt line */
      }
    }
    return runs;
  }

  async getRun(runId: string): Promise<BenchRunRecord | undefined> {
    // Defend the path join against traversal from the URL param.
    if (!/^[\w.-]+$/.test(runId)) return undefined;
    try {
      const raw = await readFile(
        path.join(this.runsDir, `${runId}.json`),
        "utf8",
      );
      return JSON.parse(raw) as BenchRunRecord;
    } catch {
      return undefined;
    }
  }
}

function toSummary(record: BenchRunRecord): BenchRunSummary {
  const a = record.aggregates;
  return {
    runId: record.runId,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    provider: record.provider,
    model: record.model,
    offline: record.offline,
    parallel: record.parallel,
    total: a.total,
    passed: a.passed,
    failed: a.failed,
    errored: a.errored,
    timedOut: a.timedOut,
    passRate: a.passRate,
    totalWallMs: a.totalWallMs,
    totalTokensIn: a.totalTokensIn,
    totalTokensOut: a.totalTokensOut,
    totalCost: a.totalCost,
    tasks: record.tasks.map((t) => ({
      id: t.id,
      status: t.status,
      wallMs: t.wallMs,
    })),
  };
}

/**
 * In-process live-tail of the current run. The runner pushes snapshots via
 * `update`; the SSE endpoint subscribes and replays the latest snapshot to
 * new connections.
 */
export class LiveRunFeed {
  private snapshot: LiveSnapshot | null = null;
  private listeners = new Set<(snapshot: LiveSnapshot) => void>();

  update(snapshot: LiveSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        /* a broken subscriber must not break the run */
      }
    }
  }

  current(): LiveSnapshot | null {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: LiveSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
