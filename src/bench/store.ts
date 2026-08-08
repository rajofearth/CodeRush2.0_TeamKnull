/**
 * bench/store — append-only run history + full run detail + live feed.
 *
 * Layout under `<workspaceRoot>/.clai/bench/`:
 *   history.jsonl              one compact line per completed run / compare
 *   runs/<runId>.json          full BenchRunRecord (CLAI, offline, or compare)
 *   compares/<compareId>.json  full CLAI-vs-pi (+ optional Codex) scorecard
 *   compare-pi.json            latest compare (dashboard default)
 *   compare-all.json           latest three-way copy when mode==="all"
 */

import { appendFile, access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BenchRunKind, BenchRunRecord, LiveSnapshot } from "./types.js";

/** Compact per-task fields needed for optimistic charts before full run fetch. */
export type BenchRunSummaryTask = {
  id: string;
  title?: string;
  category?: string;
  status: string;
  wallMs: number;
  steps?: number;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  error?: string;
};

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
  tasks: BenchRunSummaryTask[];
  kind?: BenchRunKind;
  compareId?: string;
  /** CLAI bench run linked to a compare scorecard. */
  claiRunId?: string;
};

/** Minimal compare shape the store persists (keeps store free of compare-pi imports). */
export type StoredCompareResult = {
  at: string;
  compareId?: string;
  claiRunId?: string;
  piProvider: string;
  piModel: string;
  pi: Array<Record<string, unknown>>;
  clai: Array<Record<string, unknown>>;
  piScore: {
    pass: number;
    fail: number;
    err: number;
    total: number;
    rate: number;
  };
  claiScore: {
    pass: number;
    fail: number;
    err: number;
    total: number;
    rate: number;
  };
  claiLabel?: string;
  compareParallel?: number;
  sideParallel?: number;
  partial?: boolean;
  stopped?: boolean;
  codexProfile?: string;
  codexModel?: string;
  codex?: Array<Record<string, unknown>>;
  codexScore?: {
    pass: number;
    fail: number;
    err: number;
    total: number;
    rate: number;
  };
  /** "pi" | "all" — dual vs three-way. */
  mode?: "pi" | "all";
};

export class BenchStore {
  readonly benchDir: string;
  readonly historyPath: string;
  readonly runsDir: string;
  readonly comparesDir: string;
  readonly latestComparePath: string;

  constructor(workspaceRoot: string) {
    this.benchDir = path.join(workspaceRoot, ".clai", "bench");
    this.historyPath = path.join(this.benchDir, "history.jsonl");
    this.runsDir = path.join(this.benchDir, "runs");
    this.comparesDir = path.join(this.benchDir, "compares");
    this.latestComparePath = path.join(this.benchDir, "compare-pi.json");
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

  /**
   * Persist a finished CLAI-vs-pi (or CLAI+pi+codex) compare so history can
   * rebuild dual/triple charts. Writes compares/<id>.json, compare-pi.json
   * (latest — dashboard default), optionally compare-all.json when mode==="all",
   * a runs/<id>.json view, and a history.jsonl line.
   */
  async appendCompare(result: StoredCompareResult): Promise<string> {
    const compareId =
      result.compareId ||
      `compare-pi-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(16).slice(2, 10)}`;
    const claiRunId =
      result.claiRunId ||
      (/^(\S+)/.exec(result.claiLabel || "")?.[1] ?? undefined);
    const stored: StoredCompareResult = {
      ...result,
      compareId,
      claiRunId,
      partial: undefined,
    };

    await mkdir(this.comparesDir, { recursive: true });
    await mkdir(this.runsDir, { recursive: true });

    const compareJson = JSON.stringify(stored, null, 2);
    await writeFile(
      path.join(this.comparesDir, `${compareId}.json`),
      compareJson,
      "utf8",
    );
    await writeFile(this.latestComparePath, compareJson, "utf8");
    if (stored.mode === "all" || (stored.codex && stored.codex.length)) {
      await writeFile(
        path.join(this.benchDir, "compare-all.json"),
        compareJson,
        "utf8",
      );
    }

    const record = compareToRunRecord(stored, compareId, claiRunId);
    await writeFile(
      path.join(this.runsDir, `${compareId}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
    await appendFile(
      this.historyPath,
      `${JSON.stringify(toSummary(record))}\n`,
      "utf8",
    );

    if (claiRunId) {
      await this.linkRunToCompare(claiRunId, compareId);
    }

    return compareId;
  }

  /** Attach compareId onto an existing CLAI run detail file (best-effort). */
  async linkRunToCompare(runId: string, compareId: string): Promise<void> {
    if (!/^[\w.-]+$/.test(runId)) return;
    const file = path.join(this.runsDir, `${runId}.json`);
    try {
      const raw = await readFile(file, "utf8");
      const record = JSON.parse(raw) as BenchRunRecord;
      if (record.compareId === compareId) return;
      record.compareId = compareId;
      if (!record.kind) record.kind = "clai";
      await writeFile(file, JSON.stringify(record, null, 2), "utf8");
    } catch {
      /* run detail may not exist yet */
    }
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
        runs.push(normalizeSummary(JSON.parse(line) as BenchRunSummary));
      } catch {
        /* skip corrupt line */
      }
    }
    return runs;
  }

  async getRun(runId: string): Promise<BenchRunRecord | undefined> {
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

  async getCompare(compareId?: string): Promise<StoredCompareResult | null> {
    if (compareId) {
      if (!/^[\w.-]+$/.test(compareId)) return null;
      try {
        const raw = await readFile(
          path.join(this.comparesDir, `${compareId}.json`),
          "utf8",
        );
        return JSON.parse(raw) as StoredCompareResult;
      } catch {
        /* fall through */
      }
      const run = await this.getRun(compareId);
      if (run?.compare) return run.compare as StoredCompareResult;
      return null;
    }
    try {
      const raw = await readFile(this.latestComparePath, "utf8");
      const latest = JSON.parse(raw) as StoredCompareResult;
      await this.ensureCompareArchived(latest);
      // Re-read so compareId / claiRunId filled by archive are visible to callers.
      try {
        return JSON.parse(
          await readFile(this.latestComparePath, "utf8"),
        ) as StoredCompareResult;
      } catch {
        return latest;
      }
    } catch {
      return null;
    }
  }

  /**
   * Import a legacy compare-pi.json (no archive) into compares/ + runs/ once,
   * so history selection can rebuild dual charts without re-running.
   */
  async ensureCompareArchived(result: StoredCompareResult): Promise<void> {
    if (result.partial === true) return;
    const claiRunId =
      result.claiRunId ||
      (/^(\S+)/.exec(result.claiLabel || "")?.[1] ?? undefined);
    const compareId =
      result.compareId ||
      (claiRunId ? `compare-pi-for-${claiRunId}` : null);
    if (!compareId || !/^[\w.-]+$/.test(compareId)) return;
    const archivePath = path.join(this.comparesDir, `${compareId}.json`);
    try {
      await access(archivePath);
      return; // already archived
    } catch {
      /* need to archive */
    }
    const stored: StoredCompareResult = {
      ...result,
      compareId,
      claiRunId,
      partial: undefined,
    };
    await mkdir(this.comparesDir, { recursive: true });
    await mkdir(this.runsDir, { recursive: true });
    const compareJson = JSON.stringify(stored, null, 2);
    await writeFile(archivePath, compareJson, "utf8");
    // Refresh latest pointer with ids filled in.
    await writeFile(this.latestComparePath, compareJson, "utf8");
    const record = compareToRunRecord(stored, compareId, claiRunId);
    await writeFile(
      path.join(this.runsDir, `${compareId}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
    // Avoid duplicate history lines if we already imported this id.
    const existing = await this.listRuns();
    if (!existing.some((r) => r.runId === compareId)) {
      await appendFile(
        this.historyPath,
        `${JSON.stringify(toSummary(record))}\n`,
        "utf8",
      );
    }
    if (claiRunId) await this.linkRunToCompare(claiRunId, compareId);
  }

  /** Resolve compare linked to a CLAI run id (via record.compareId or claiLabel). */
  async findCompareForRun(runId: string): Promise<StoredCompareResult | null> {
    if (!/^[\w.-]+$/.test(runId)) return null;
    const run = await this.getRun(runId);
    if (run?.kind === "compare" && run.compare) {
      return run.compare as StoredCompareResult;
    }
    if (run?.compareId) {
      const linked = await this.getCompare(run.compareId);
      if (linked) return linked;
    }
    try {
      const names = await readdir(this.comparesDir);
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          const c = JSON.parse(
            await readFile(path.join(this.comparesDir, name), "utf8"),
          ) as StoredCompareResult;
          if (c.claiRunId === runId) return c;
          if ((c.claiLabel || "").startsWith(runId)) return c;
        } catch {
          /* skip */
        }
      }
    } catch {
      /* no compares dir yet */
    }
    const latest = await this.getCompare();
    if (
      latest &&
      (latest.claiRunId === runId ||
        (latest.claiLabel || "").startsWith(runId) ||
        latest.compareId === runId)
    ) {
      return latest;
    }
    return null;
  }
}

function normalizeSummary(s: BenchRunSummary): BenchRunSummary {
  return {
    ...s,
    tasks: (s.tasks || []).map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      status: t.status,
      wallMs: Number(t.wallMs) || 0,
      steps: t.steps,
      tokensIn: t.tokensIn,
      tokensOut: t.tokensOut,
      cost: t.cost,
      error: t.error,
    })),
  };
}

function toSummary(record: BenchRunRecord): BenchRunSummary {
  const a = record.aggregates;
  const compare = record.compare as StoredCompareResult | undefined;
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
    kind: record.kind,
    compareId: record.compareId ?? compare?.compareId,
    claiRunId: compare?.claiRunId,
    tasks: record.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      status: t.status,
      wallMs: t.wallMs,
      steps: t.steps,
      tokensIn: Number(t.tokensIn) || 0,
      tokensOut: Number(t.tokensOut) || 0,
      cost: Number(t.cost) || 0,
      error: t.error,
    })),
  };
}

function compareToRunRecord(
  stored: StoredCompareResult,
  compareId: string,
  claiRunId?: string,
): BenchRunRecord {
  const clai = stored.clai || [];
  const pi = stored.pi || [];
  const codex = stored.codex || [];
  const byPi = new Map(pi.map((r) => [String(r.id), r]));
  const byCodex = new Map(codex.map((r) => [String(r.id), r]));
  const hasCodex =
    stored.mode === "all" ||
    (Array.isArray(stored.codex) && stored.codex.length > 0) ||
    !!stored.codexScore;
  const tasks = clai.map((c) => {
    const p = byPi.get(String(c.id));
    const x = byCodex.get(String(c.id));
    const cStatus = String(c.status || "error");
    const pStatus = p ? String(p.status || "error") : "error";
    const xStatus = x ? String(x.status || "error") : hasCodex ? "error" : "pass";
    const allPass = hasCodex
      ? cStatus === "pass" && pStatus === "pass" && xStatus === "pass"
      : cStatus === "pass" && pStatus === "pass";
    const anyFail = hasCodex
      ? cStatus === "fail" || pStatus === "fail" || xStatus === "fail"
      : cStatus === "fail" || pStatus === "fail";
    const status = allPass ? "pass" : anyFail ? "fail" : "error";
    const errorParts = [
      `clai=${cStatus}`,
      `pi=${pStatus}`,
      hasCodex ? `codex=${xStatus}` : "",
    ].filter(Boolean);
    return {
      id: String(c.id),
      title: String(c.id),
      category: "bugfix" as const,
      status: status as BenchRunRecord["tasks"][number]["status"],
      wallMs: Math.max(
        Number(c.wallMs) || 0,
        Number(p?.wallMs) || 0,
        Number(x?.wallMs) || 0,
      ),
      steps: 0,
      toolCalls: {},
      tokensIn:
        (Number(c.tokensIn) || 0) +
        (Number(p?.tokensIn) || 0) +
        (Number(x?.tokensIn) || 0),
      tokensOut:
        (Number(c.tokensOut) || 0) +
        (Number(p?.tokensOut) || 0) +
        (Number(x?.tokensOut) || 0),
      cost:
        (Number(c.cost) || 0) + (Number(p?.cost) || 0) + (Number(x?.cost) || 0),
      error: errorParts.join(" · "),
    };
  });
  const passed = tasks.filter((t) => t.status === "pass").length;
  const failed = tasks.filter((t) => t.status === "fail").length;
  const errored = tasks.filter((t) => t.status === "error").length;
  return {
    runId: compareId,
    startedAt: stored.at,
    finishedAt: stored.at,
    provider: hasCodex ? "clai+pi+codex" : "clai+pi",
    model: stored.piModel,
    offline: false,
    parallel: stored.sideParallel || stored.compareParallel || 1,
    taskIds: tasks.map((t) => t.id),
    tasks,
    aggregates: {
      total: tasks.length,
      passed,
      failed,
      errored,
      timedOut: 0,
      passRate: tasks.length ? passed / tasks.length : 0,
      totalWallMs: tasks.reduce((a, t) => a + t.wallMs, 0),
      totalTokensIn: tasks.reduce((a, t) => a + t.tokensIn, 0),
      totalTokensOut: tasks.reduce((a, t) => a + t.tokensOut, 0),
      totalCost: tasks.reduce((a, t) => a + t.cost, 0),
    },
    kind: "compare",
    compareId,
    compare: { ...stored, compareId, claiRunId },
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
