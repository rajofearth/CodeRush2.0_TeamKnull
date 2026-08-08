/**
 * bench/report — researcher-grade scorecard report from compare/run evidence.
 *
 * Local stats + compact CLAI traces feed one structured LLM call so a full
 * report typically lands in well under two minutes.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateObject, generateText, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { loadEnvFiles } from "../adapter/env.js";
import {
  createProviderHandle,
  hasProviderKey,
  type ProviderId,
} from "../adapter/providers.js";
import type { BenchStore, StoredCompareResult } from "./store.js";
import type { BenchRunRecord } from "./types.js";

export type ReportHarness = "clai" | "pi" | "codex";

export type ReportStage =
  | "queued"
  | "resolve"
  | "stats"
  | "traces"
  | "analyze"
  | "assemble"
  | "export"
  | "done"
  | "error";

export type ReportChartSeries = {
  harness: ReportHarness;
  label: string;
  pass: number;
  fail: number;
  err: number;
  total: number;
  rate: number;
  avgWallMs: number;
  p50WallMs: number;
  p95WallMs: number;
  avgTokensIn: number;
  avgTokensOut: number;
  totalCost: number;
};

export type ReportTaskRow = {
  id: string;
  clai?: string;
  pi?: string;
  codex?: string;
  claiWallMs?: number;
  piWallMs?: number;
  codexWallMs?: number;
  note?: string;
};

export type TraceBeat = {
  kind: "tool" | "text" | "error" | "info";
  summary: string;
};

export type TraceDigest = {
  taskId: string;
  harness: ReportHarness;
  status: string;
  wallMs?: number;
  toolCounts: Record<string, number>;
  timeline: TraceBeat[];
  error?: string;
  checkTail?: string;
};

export type ReportEvidence = {
  source: {
    compareId?: string;
    runId?: string;
    at: string;
    mode?: "pi" | "all" | "run";
  };
  models: {
    clai?: string;
    pi?: string;
    codex?: string;
  };
  charts: {
    series: ReportChartSeries[];
    tasks: ReportTaskRow[];
    categoryPass?: Array<{ category: string; pass: number; total: number }>;
  };
  highlights: {
    disagreements: string[];
    failures: string[];
    slowest: string[];
    cheapestWins: string[];
  };
  digests: TraceDigest[];
  facts: string[];
};

export type ReportAnalysis = {
  title: string;
  abstract: string;
  executiveSummary: string;
  methodologyNotes: string;
  harnessComparison: string;
  insights: string[];
  interestingFinds: Array<{
    title: string;
    detail: string;
    significance: string;
  }>;
  caseStudies: Array<{
    taskId: string;
    harness: string;
    verdict: "strength" | "weakness" | "anomaly";
    narrative: string;
  }>;
  limitations: string;
  conclusion: string;
  recommendations: string[];
};

export type BenchReport = {
  reportId: string;
  createdAt: string;
  finishedAt: string;
  durationMs: number;
  provider: string;
  model: string;
  evidence: ReportEvidence;
  analysis: ReportAnalysis;
  /** Absolute paths written under `.clai/bench/reports/`. */
  exports?: {
    pdf?: string;
    docx?: string;
  };
};

export type BenchReportProgress = {
  reportId: string;
  status: "running" | "done" | "error";
  stage: ReportStage;
  progress: number;
  message: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  report?: BenchReport;
};

export type CreateBenchReportOptions = {
  store: BenchStore;
  compareId?: string;
  runId?: string;
  onProgress?: (p: BenchReportProgress) => void;
  signal?: AbortSignal;
  /** Inject analyzer (tests / offline). */
  analyze?: (evidence: ReportEvidence) => Promise<ReportAnalysis>;
  /** Cap CLAI traces read (default 8). */
  maxTraces?: number;
};

const analysisSchema = z.object({
  title: z.string().describe("Concise research-paper title"),
  abstract: z
    .string()
    .describe("≤180 word abstract covering setup, results, takeaways"),
  executiveSummary: z
    .string()
    .describe("3–5 sentence executive summary for practitioners"),
  methodologyNotes: z
    .string()
    .describe("How to interpret the harness race and scoring"),
  harnessComparison: z
    .string()
    .describe("Comparative analysis of harnesses / models with numbers"),
  insights: z
    .array(z.string())
    .min(3)
    .max(8)
    .describe("Bullet insights grounded in the evidence"),
  interestingFinds: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        significance: z.string(),
      }),
    )
    .min(2)
    .max(6),
  caseStudies: z
    .array(
      z.object({
        taskId: z.string(),
        harness: z.string(),
        verdict: z.enum(["strength", "weakness", "anomaly"]),
        narrative: z.string(),
      }),
    )
    .max(8),
  limitations: z.string(),
  conclusion: z.string(),
  recommendations: z.array(z.string()).min(2).max(6),
});

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function trunc(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("report aborted");
    err.name = "AbortError";
    throw err;
  }
}

type RowLike = {
  id: string;
  status: string;
  wallMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  detail?: string;
  error?: string;
};

function seriesFromRows(
  harness: ReportHarness,
  label: string,
  rows: RowLike[],
): ReportChartSeries {
  const pass = rows.filter((r) => r.status === "pass").length;
  const fail = rows.filter((r) => r.status === "fail").length;
  const err = rows.filter(
    (r) => r.status === "error" || r.status === "timeout",
  ).length;
  const walls = rows
    .map((r) => Number(r.wallMs) || 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const tin = rows.map((r) => Number(r.tokensIn) || 0);
  const tout = rows.map((r) => Number(r.tokensOut) || 0);
  const cost = rows.reduce((a, r) => a + (Number(r.cost) || 0), 0);
  return {
    harness,
    label,
    pass,
    fail,
    err,
    total: rows.length,
    rate: rows.length ? pass / rows.length : 0,
    avgWallMs: avg(walls),
    p50WallMs: percentile(walls, 50),
    p95WallMs: percentile(walls, 95),
    avgTokensIn: avg(tin),
    avgTokensOut: avg(tout),
    totalCost: cost,
  };
}

function rowsFromCompare(
  compare: StoredCompareResult,
): Record<ReportHarness, RowLike[]> {
  return {
    clai: (compare.clai || []) as RowLike[],
    pi: (compare.pi || []) as RowLike[],
    codex: (compare.codex || []) as RowLike[],
  };
}

function rowsFromRun(run: BenchRunRecord): RowLike[] {
  return run.tasks.map((t) => ({
    id: t.id,
    status: t.status,
    wallMs: t.wallMs,
    tokensIn: t.tokensIn,
    tokensOut: t.tokensOut,
    cost: t.cost,
    detail: t.error || t.checkOutput,
    error: t.error,
  }));
}

/** Pick the most informative tasks for trace digests + case studies. */
export function selectInterestingTaskIds(
  compare: StoredCompareResult | null,
  run: BenchRunRecord | null,
  limit = 8,
): string[] {
  const scores = new Map<string, number>();
  const bump = (id: string, n: number) =>
    scores.set(id, (scores.get(id) || 0) + n);

  if (compare) {
    const byId = new Map<string, Partial<Record<ReportHarness, RowLike>>>();
    for (const [harness, rows] of Object.entries(rowsFromCompare(compare)) as Array<
      [ReportHarness, RowLike[]]
    >) {
      for (const r of rows) {
        const slot = byId.get(r.id) || {};
        slot[harness] = r;
        byId.set(r.id, slot);
        if (r.status !== "pass") bump(r.id, 5);
        if (r.detail || r.error) bump(r.id, 1);
      }
    }
    for (const [id, slot] of byId) {
      const statuses = [slot.clai?.status, slot.pi?.status, slot.codex?.status].filter(
        Boolean,
      );
      if (new Set(statuses).size > 1) bump(id, 8);
      const walls = [slot.clai?.wallMs, slot.pi?.wallMs, slot.codex?.wallMs]
        .map((n) => Number(n) || 0)
        .filter((n) => n > 0);
      if (walls.length >= 2) {
        const lo = Math.min(...walls);
        const hi = Math.max(...walls);
        if (hi > lo * 2.5) bump(id, 3);
      }
    }
  }

  if (run) {
    for (const t of run.tasks) {
      if (t.status !== "pass") bump(t.id, 6);
      if (t.tracePath) bump(t.id, 1);
      if ((t.wallMs || 0) > 60_000) bump(t.id, 2);
    }
    const passed = run.tasks
      .filter((t) => t.status === "pass" && t.wallMs > 0)
      .sort((a, b) => a.wallMs - b.wallMs);
    if (passed[0]) bump(passed[0].id, 2);
    if (passed.length > 1) bump(passed[passed.length - 1]!.id, 2);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}

export async function summarizeTraceFile(
  filePath: string,
  meta: { taskId: string; status: string; wallMs?: number; toolCalls?: Record<string, number>; error?: string; checkOutput?: string },
): Promise<TraceDigest> {
  const timeline: TraceBeat[] = [];
  const toolCounts: Record<string, number> = { ...(meta.toolCalls || {}) };
  try {
    const raw = await readFile(filePath, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = String(ev.type || "");
      if (type === "tool_call") {
        const tool = String(ev.tool || "tool");
        toolCounts[tool] = (toolCounts[tool] || 0) + (meta.toolCalls ? 0 : 1);
        const target = ev.target ? String(ev.target) : "";
        timeline.push({
          kind: "tool",
          summary: trunc(`→ ${tool}${target ? ` ${target}` : ""}`, 160),
        });
      } else if (type === "tool_result") {
        const ok = ev.ok !== false;
        const tool = String(ev.tool || "tool");
        if (!ok) {
          timeline.push({
            kind: "error",
            summary: trunc(`✗ ${tool} failed`, 160),
          });
        }
      } else if (type === "assistant_text") {
        const text = String(ev.text || "");
        if (text.trim()) {
          timeline.push({ kind: "text", summary: trunc(text, 220) });
        }
      } else if (type === "error") {
        timeline.push({
          kind: "error",
          summary: trunc(String(ev.message || ev.error || "error"), 200),
        });
      }
      if (timeline.length >= 24) break;
    }
  } catch {
    timeline.push({ kind: "info", summary: "trace unavailable" });
  }

  // Prefer compact toolCounts from task record when present.
  const counts =
    meta.toolCalls && Object.keys(meta.toolCalls).length
      ? meta.toolCalls
      : toolCounts;

  return {
    taskId: meta.taskId,
    harness: "clai",
    status: meta.status,
    wallMs: meta.wallMs,
    toolCounts: counts,
    timeline: timeline.slice(0, 18),
    error: meta.error,
    checkTail: meta.checkOutput ? trunc(meta.checkOutput, 400) : undefined,
  };
}

function buildHighlights(
  compare: StoredCompareResult | null,
  run: BenchRunRecord | null,
): ReportEvidence["highlights"] {
  const disagreements: string[] = [];
  const failures: string[] = [];
  const slowest: string[] = [];
  const cheapestWins: string[] = [];

  if (compare) {
    const { clai, pi, codex } = rowsFromCompare(compare);
    const ids = [
      ...new Set([...clai, ...pi, ...codex].map((r) => r.id)),
    ].sort();
    for (const id of ids) {
      const c = clai.find((r) => r.id === id);
      const p = pi.find((r) => r.id === id);
      const x = codex.find((r) => r.id === id);
      const statuses = [c?.status, p?.status, x?.status].filter(Boolean);
      if (new Set(statuses).size > 1) {
        disagreements.push(
          `${id}: clai=${c?.status ?? "—"} pi=${p?.status ?? "—"}` +
            (codex.length ? ` codex=${x?.status ?? "—"}` : ""),
        );
      }
      for (const [name, row] of [
        ["clai", c],
        ["pi", p],
        ["codex", x],
      ] as const) {
        if (row && row.status !== "pass") {
          failures.push(
            `${name}/${id}: ${row.status}${row.detail || row.error ? ` — ${trunc(String(row.detail || row.error), 120)}` : ""}`,
          );
        }
      }
    }
    const withWall = clai
      .filter((r) => (r.wallMs || 0) > 0)
      .sort((a, b) => (b.wallMs || 0) - (a.wallMs || 0));
    for (const r of withWall.slice(0, 3)) {
      slowest.push(`clai/${r.id}: ${Math.round(r.wallMs || 0)}ms`);
    }
    const passCost = clai
      .filter((r) => r.status === "pass" && (Number(r.cost) || 0) > 0)
      .sort((a, b) => (Number(a.cost) || 0) - (Number(b.cost) || 0));
    for (const r of passCost.slice(0, 3)) {
      cheapestWins.push(
        `clai/${r.id}: $${(Number(r.cost) || 0).toFixed(4)} / ${Math.round(r.wallMs || 0)}ms`,
      );
    }
  } else if (run) {
    for (const t of run.tasks) {
      if (t.status !== "pass") {
        failures.push(
          `clai/${t.id}: ${t.status}${t.error ? ` — ${trunc(t.error, 120)}` : ""}`,
        );
      }
    }
    const withWall = [...run.tasks]
      .filter((t) => t.wallMs > 0)
      .sort((a, b) => b.wallMs - a.wallMs);
    for (const t of withWall.slice(0, 3)) {
      slowest.push(`clai/${t.id}: ${Math.round(t.wallMs)}ms`);
    }
  }

  return {
    disagreements: disagreements.slice(0, 12),
    failures: failures.slice(0, 12),
    slowest: slowest.slice(0, 5),
    cheapestWins: cheapestWins.slice(0, 5),
  };
}

function buildFacts(
  compare: StoredCompareResult | null,
  run: BenchRunRecord | null,
  series: ReportChartSeries[],
): string[] {
  const facts: string[] = [];
  for (const s of series) {
    facts.push(
      `${s.label}: ${s.pass}/${s.total} pass (${(s.rate * 100).toFixed(0)}%), avg wall ${Math.round(s.avgWallMs)}ms, cost $${s.totalCost.toFixed(4)}`,
    );
  }
  if (compare?.sideParallel) {
    facts.push(`sideParallel=${compare.sideParallel} workers per harness`);
  }
  if (compare?.stopped) facts.push("compare was stopped early");
  if (run?.aggregates) {
    facts.push(
      `CLAI run ${run.runId}: ${run.aggregates.passed}/${run.aggregates.total} pass, tokens in/out ${run.aggregates.totalTokensIn}/${run.aggregates.totalTokensOut}`,
    );
  }
  return facts;
}

export async function buildReportEvidence(
  store: BenchStore,
  opts: {
    compareId?: string;
    runId?: string;
    maxTraces?: number;
    onTrace?: (taskId: string) => void;
    signal?: AbortSignal;
  },
): Promise<ReportEvidence> {
  assertNotAborted(opts.signal);
  let compare: StoredCompareResult | null = null;
  let run: BenchRunRecord | undefined;

  if (opts.compareId) {
    compare = await store.getCompare(opts.compareId);
  }
  if (!compare && !opts.runId) {
    compare = await store.getCompare();
  }
  if (opts.runId) {
    run = await store.getRun(opts.runId);
    if (!compare && run?.compare) {
      compare = run.compare as StoredCompareResult;
    }
    if (!compare) {
      compare = await store.findCompareForRun(opts.runId);
    }
  }
  if (!run && compare?.claiRunId) {
    run = await store.getRun(compare.claiRunId);
  }
  if (!compare && !run) {
    throw new Error(
      "No compare or run found. Run a bench/compare first, then generate a report.",
    );
  }

  const series: ReportChartSeries[] = [];
  const tasks: ReportTaskRow[] = [];
  let categoryPass: ReportEvidence["charts"]["categoryPass"];

  if (compare) {
    const packs = rowsFromCompare(compare);
    const claiLabel =
      compare.claiLabel ||
      `CLAI${compare.claiRunId ? ` ${compare.claiRunId}` : ""}`;
    if (packs.clai.length) {
      series.push(seriesFromRows("clai", claiLabel, packs.clai));
    }
    if (packs.pi.length) {
      series.push(
        seriesFromRows(
          "pi",
          `pi ${compare.piProvider}/${compare.piModel}`,
          packs.pi,
        ),
      );
    }
    if (packs.codex.length) {
      series.push(
        seriesFromRows(
          "codex",
          `codex ${compare.codexProfile || compare.codexModel || "default"}`,
          packs.codex,
        ),
      );
    }
    const ids = [
      ...new Set(
        [...packs.clai, ...packs.pi, ...packs.codex].map((r) => r.id),
      ),
    ].sort();
    for (const id of ids) {
      const c = packs.clai.find((r) => r.id === id);
      const p = packs.pi.find((r) => r.id === id);
      const x = packs.codex.find((r) => r.id === id);
      const notes = [c?.detail, p?.detail, x?.detail].filter(Boolean);
      tasks.push({
        id,
        clai: c?.status,
        pi: p?.status,
        codex: x?.status,
        claiWallMs: c?.wallMs,
        piWallMs: p?.wallMs,
        codexWallMs: x?.wallMs,
        note: notes[0] ? trunc(String(notes[0]), 160) : undefined,
      });
    }
  } else if (run) {
    const rows = rowsFromRun(run);
    series.push(
      seriesFromRows("clai", `${run.runId} [${run.provider}/${run.model}]`, rows),
    );
    for (const t of run.tasks) {
      tasks.push({
        id: t.id,
        clai: t.status,
        claiWallMs: t.wallMs,
        note: t.error ? trunc(t.error, 160) : undefined,
      });
    }
    const byCat = new Map<string, { pass: number; total: number }>();
    for (const t of run.tasks) {
      const slot = byCat.get(t.category) || { pass: 0, total: 0 };
      slot.total += 1;
      if (t.status === "pass") slot.pass += 1;
      byCat.set(t.category, slot);
    }
    categoryPass = [...byCat.entries()].map(([category, v]) => ({
      category,
      ...v,
    }));
  }

  const highlights = buildHighlights(compare, run || null);
  const interesting = selectInterestingTaskIds(
    compare,
    run || null,
    opts.maxTraces ?? 8,
  );

  const digests: TraceDigest[] = [];
  if (run) {
    const byId = new Map(run.tasks.map((t) => [t.id, t]));
    for (const id of interesting) {
      assertNotAborted(opts.signal);
      const t = byId.get(id);
      if (!t) continue;
      opts.onTrace?.(id);
      if (t.tracePath) {
        digests.push(
          await summarizeTraceFile(t.tracePath, {
            taskId: t.id,
            status: t.status,
            wallMs: t.wallMs,
            toolCalls: t.toolCalls,
            error: t.error,
            checkOutput: t.checkOutput,
          }),
        );
      } else {
        digests.push({
          taskId: t.id,
          harness: "clai",
          status: t.status,
          wallMs: t.wallMs,
          toolCounts: t.toolCalls || {},
          timeline: [
            {
              kind: "info",
              summary: t.error
                ? trunc(t.error, 200)
                : "no trace file for this task",
            },
          ],
          error: t.error,
          checkTail: t.checkOutput ? trunc(t.checkOutput, 400) : undefined,
        });
      }
    }
  }

  // Side-harness failure notes when we lack their traces.
  if (compare) {
    for (const id of interesting) {
      for (const harness of ["pi", "codex"] as const) {
        const row = (compare[harness] || []).find(
          (r) => (r as RowLike).id === id,
        ) as RowLike | undefined;
        if (!row || row.status === "pass") continue;
        if (digests.some((d) => d.taskId === id && d.harness === harness)) {
          continue;
        }
        digests.push({
          taskId: id,
          harness,
          status: row.status,
          wallMs: row.wallMs,
          toolCounts: {},
          timeline: [
            {
              kind: "error",
              summary: trunc(
                String(row.detail || row.error || `${harness} ${row.status}`),
                240,
              ),
            },
          ],
          error: row.detail || row.error,
        });
      }
    }
  }

  const claiModel =
    run?.model ||
    (/\[([^\]]+)\]/.exec(compare?.claiLabel || "")?.[1] ?? undefined);

  return {
    source: {
      compareId: compare?.compareId,
      runId: run?.runId || compare?.claiRunId,
      at: compare?.at || run?.finishedAt || new Date().toISOString(),
      mode: compare ? compare.mode || (compare.codex?.length ? "all" : "pi") : "run",
    },
    models: {
      clai: claiModel
        ? `${run?.provider || "clai"}/${claiModel}`
        : undefined,
      pi: compare ? `${compare.piProvider}/${compare.piModel}` : undefined,
      codex: compare?.codexModel
        ? `codex/${compare.codexModel}`
        : compare?.codexProfile
          ? `codex/${compare.codexProfile}`
          : undefined,
    },
    charts: { series, tasks, categoryPass },
    highlights,
    digests,
    facts: buildFacts(compare, run || null, series),
  };
}

function fallbackAnalysis(evidence: ReportEvidence): ReportAnalysis {
  const rates = evidence.charts.series
    .map((s) => `${s.harness} ${(s.rate * 100).toFixed(0)}%`)
    .join(", ");
  const ranked = [...evidence.charts.series].sort((a, b) => b.rate - a.rate);
  const insights = [
    ...evidence.highlights.disagreements
      .slice(0, 3)
      .map((d) => `Disagreement: ${d}`),
    ...evidence.highlights.failures.slice(0, 3).map((f) => `Failure: ${f}`),
    ranked[0]
      ? `Lead harness by pass rate: ${ranked[0].label} (${(ranked[0].rate * 100).toFixed(0)}%)`
      : "Insufficient series for ranking.",
    evidence.facts[0] ? `Scorecard: ${evidence.facts[0]}` : "No scorecard facts.",
    evidence.digests[0]
      ? `Sample trajectory: ${evidence.digests[0].taskId} (${evidence.digests[0].status}) with ${evidence.digests[0].timeline.length} beats`
      : "No trajectory digests available.",
    evidence.highlights.slowest[0]
      ? `Slowest observed: ${evidence.highlights.slowest[0]}`
      : "No wall-time outliers recorded.",
  ].filter(Boolean);
  const interestingFinds =
    evidence.highlights.disagreements.length > 0
      ? evidence.highlights.disagreements.slice(0, 3).map((d) => ({
          title: "Cross-harness disagreement",
          detail: d,
          significance:
            "Shows where tooling or orchestration diverges under the same task.",
        }))
      : [
          {
            title: "Aligned outcomes",
            detail:
              evidence.facts[0] ||
              "Harnesses produced matching pass/fail patterns on the sampled tasks.",
            significance:
              "Agreement is informative when models and tools are supposed to be comparable.",
          },
          {
            title: "Efficiency snapshot",
            detail:
              ranked[0]
                ? `${ranked[0].harness} avg wall ${Math.round(ranked[0].avgWallMs)}ms, cost $${ranked[0].totalCost.toFixed(4)}`
                : "No efficiency series.",
            significance: "Cost and latency matter as much as raw pass rate.",
          },
        ];
  return {
    title: "Harness Benchmark Scorecard",
    abstract: `This report summarizes an agent coding harness evaluation (${evidence.source.mode}). Measured pass rates: ${rates}. Evidence includes ${evidence.charts.tasks.length} tasks and ${evidence.digests.length} trajectory digests.`,
    executiveSummary: evidence.facts.slice(0, 4).join(" "),
    methodologyNotes:
      "Tasks are scored pass/fail/error from fixture checks. Wall time includes agent work plus verification. Cost uses published token pricing estimates.",
    harnessComparison: evidence.facts.join("\n"),
    insights: insights.slice(0, 8),
    interestingFinds: interestingFinds.slice(0, 6),
    caseStudies: evidence.digests.slice(0, 4).map((d) => ({
      taskId: d.taskId,
      harness: d.harness,
      verdict: d.status === "pass" ? ("strength" as const) : ("weakness" as const),
      narrative:
        d.timeline.map((b) => b.summary).join(" → ") || d.error || d.status,
    })),
    limitations:
      "Offline fallback analysis — regenerate with an API key for full narrative synthesis.",
    conclusion: evidence.facts[0] || "No conclusive scorecard facts available.",
    recommendations: [
      "Re-run failed tasks serially to separate quota stalls from genuine regressions.",
      "Inspect CLAI traces for the highest-impact disagreements first.",
    ],
  };
}

function coerceAnalysis(
  partial: unknown,
  evidence: ReportEvidence,
): ReportAnalysis {
  const fb = fallbackAnalysis(evidence);
  const p =
    partial && typeof partial === "object"
      ? (partial as Record<string, unknown>)
      : {};
  const merged = {
    ...fb,
    ...p,
    insights: Array.isArray(p.insights) && p.insights.length
      ? p.insights
      : fb.insights,
    interestingFinds:
      Array.isArray(p.interestingFinds) && p.interestingFinds.length
        ? p.interestingFinds
        : fb.interestingFinds,
    caseStudies:
      Array.isArray(p.caseStudies) && p.caseStudies.length
        ? p.caseStudies
        : fb.caseStudies,
    recommendations:
      Array.isArray(p.recommendations) && p.recommendations.length
        ? p.recommendations
        : fb.recommendations,
  };
  const parsed = analysisSchema.safeParse(merged);
  return parsed.success ? parsed.data : fb;
}

function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function analyzeEvidenceWithLlm(
  evidence: ReportEvidence,
  opts?: { signal?: AbortSignal },
): Promise<{ analysis: ReportAnalysis; provider: string; model: string }> {
  await loadEnvFiles();
  // Prefer a fast non-thinking model for structured JSON reports.
  // Clear CLAI_MODEL when switching providers so DeepSeek session models
  // are not sent to Groq/Gateway (unless CLAI_REPORT_MODEL is set).
  const preferEnv = process.env.CLAI_REPORT_PROVIDER as ProviderId | undefined;
  let prefer: ProviderId | undefined = preferEnv;
  if (!prefer) {
    if (hasProviderKey("groq")) prefer = "groq";
    else if (hasProviderKey("gateway")) prefer = "gateway";
    else if (hasProviderKey("gemini")) prefer = "gemini";
  }

  const prevModel = process.env.CLAI_MODEL;
  if (prefer && !process.env.CLAI_REPORT_MODEL) {
    delete process.env.CLAI_MODEL;
  }
  let handle;
  try {
    handle = await createProviderHandle(
      prefer,
      process.env.CLAI_REPORT_MODEL || undefined,
    );
  } finally {
    if (prevModel != null) process.env.CLAI_MODEL = prevModel;
    else if (prefer && !process.env.CLAI_REPORT_MODEL) {
      delete process.env.CLAI_MODEL;
    }
  }

  // Keep the LLM payload lean — charts + highlights + compact digests.
  const compact = {
    source: evidence.source,
    models: evidence.models,
    facts: evidence.facts,
    charts: {
      series: evidence.charts.series,
      tasks: evidence.charts.tasks.slice(0, 24),
    },
    highlights: evidence.highlights,
    digests: evidence.digests.map((d) => ({
      taskId: d.taskId,
      harness: d.harness,
      status: d.status,
      wallMs: d.wallMs,
      toolCounts: d.toolCounts,
      error: d.error,
      timeline: d.timeline.slice(0, 10),
    })),
  };

  const prompt = [
    "Write a researcher-grade but compact evaluation of coding-agent harnesses.",
    "Use ONLY the evidence JSON. Cite task ids, pass rates, walls, and costs.",
    "Keep abstract ≤180 words. Insights must be specific, not generic.",
    "Call out strong tool use vs failures/stalls from trajectory digests.",
    "Return ALL required keys: title, abstract, executiveSummary, methodologyNotes,",
    "harnessComparison, insights, interestingFinds, caseStudies, limitations,",
    "conclusion, recommendations.",
    "",
    JSON.stringify(compact),
  ].join("\n");

  try {
    const result = await generateObject({
      model: handle.model as Parameters<typeof generateObject>[0]["model"],
      schema: analysisSchema,
      mode: "json",
      system:
        "You analyze agent harness benchmark scorecards. Prefer quantitative claims tied to evidence. Keep sections tight. Respond with a single JSON object matching the schema — include every required field.",
      prompt,
      maxRetries: 1,
      maxTokens: 3200,
      abortSignal: opts?.signal,
    });
    return {
      analysis: result.object,
      provider: handle.id,
      model: handle.modelId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/rate limit|tokens per minute|TPM/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 5500));
      assertNotAborted(opts?.signal);
      const retryObj = await generateObject({
        model: handle.model as Parameters<typeof generateObject>[0]["model"],
        schema: analysisSchema,
        mode: "json",
        system:
          "You analyze agent harness benchmark scorecards. Prefer quantitative claims tied to evidence. Keep sections tight. Respond with a single JSON object matching the schema — include every required field.",
        prompt,
        maxRetries: 0,
        maxTokens: 3200,
        abortSignal: opts?.signal,
      });
      return {
        analysis: retryObj.object,
        provider: handle.id,
        model: handle.modelId,
      };
    }
    // Groq/OSS models sometimes omit trailing fields — coerce or free-form retry.
    let partial: unknown = null;
    if (NoObjectGeneratedError.isInstance(err)) {
      const raw =
        (err as { text?: string; cause?: unknown }).text ||
        String((err as { message?: string }).message || "");
      partial = extractJsonObject(raw);
      const cause = (err as { cause?: { message?: string } }).cause;
      if (!partial && cause?.message) {
        const m = /failed_generation[\s\S]*?(\{[\s\S]*\})/i.exec(
          String((err as Error).message),
        );
        if (m?.[1]) partial = extractJsonObject(m[1]);
      }
      // AI SDK often puts the broken JSON in err.text
      const anyErr = err as { text?: string; response?: { body?: unknown } };
      if (!partial && anyErr.text) partial = extractJsonObject(anyErr.text);
    }

    if (!partial) {
      const retry = await generateText({
        model: handle.model as Parameters<typeof generateText>[0]["model"],
        system:
          "Return ONLY one JSON object for a harness benchmark report. Required keys: title, abstract, executiveSummary, methodologyNotes, harnessComparison, insights (string[]), interestingFinds ({title,detail,significance}[]), caseStudies ({taskId,harness,verdict,narrative}[]), limitations, conclusion, recommendations (string[]).",
        prompt,
        maxRetries: 0,
        maxTokens: 3200,
        abortSignal: opts?.signal,
      });
      partial = extractJsonObject(retry.text);
    }

    if (!partial) throw err;
    return {
      analysis: coerceAnalysis(partial, evidence),
      provider: handle.id,
      model: handle.modelId,
    };
  }
}

export async function createBenchReport(
  opts: CreateBenchReportOptions,
): Promise<BenchReport> {
  const reportId = `report-${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString("hex")}`;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const publish = (
    partial: Omit<BenchReportProgress, "reportId" | "startedAt"> & {
      reportId?: string;
      startedAt?: string;
    },
  ) => {
    opts.onProgress?.({
      reportId,
      startedAt,
      ...partial,
    });
  };

  try {
    publish({
      status: "running",
      stage: "resolve",
      progress: 5,
      message: "Resolving compare / run source…",
    });
    assertNotAborted(opts.signal);

    publish({
      status: "running",
      stage: "stats",
      progress: 18,
      message: "Computing scorecard charts and highlights…",
    });

    const evidence = await buildReportEvidence(opts.store, {
      compareId: opts.compareId,
      runId: opts.runId,
      maxTraces: opts.maxTraces ?? 8,
      signal: opts.signal,
      onTrace: (taskId) => {
        publish({
          status: "running",
          stage: "traces",
          progress: 35,
          message: `Digesting trajectory · ${taskId}`,
        });
      },
    });

    publish({
      status: "running",
      stage: "traces",
      progress: 55,
      message: `Packed ${evidence.digests.length} trajectory digests`,
    });
    assertNotAborted(opts.signal);

    publish({
      status: "running",
      stage: "analyze",
      progress: 62,
      message: "LLM synthesizing researcher report…",
    });

    let analysis: ReportAnalysis;
    let provider = "offline";
    let model = "fallback";
    if (opts.analyze) {
      analysis = await opts.analyze(evidence);
    } else if (process.env.CLAI_REPORT_OFFLINE === "1") {
      analysis = fallbackAnalysis(evidence);
    } else {
      try {
        const llm = await analyzeEvidenceWithLlm(evidence, {
          signal: opts.signal,
        });
        analysis = llm.analysis;
        provider = llm.provider;
        model = llm.model;
      } catch (err) {
        // Still deliver a usable report if the model call fails.
        analysis = fallbackAnalysis(evidence);
        analysis.limitations = `${analysis.limitations} LLM error: ${
          err instanceof Error ? err.message : String(err)
        }`;
        provider = "fallback";
        model = "local-stats";
      }
    }

    publish({
      status: "running",
      stage: "assemble",
      progress: 88,
      message: "Assembling figures and paper sections…",
    });

    const finishedAt = new Date().toISOString();
    const report: BenchReport = {
      reportId,
      createdAt: startedAt,
      finishedAt,
      durationMs: Date.now() - t0,
      provider,
      model,
      evidence,
      analysis,
    };

    publish({
      status: "running",
      stage: "export",
      progress: 92,
      message: "Writing PDF + DOCX…",
    });
    await persistReport(opts.store, report);

    publish({
      status: "done",
      stage: "done",
      progress: 100,
      message: `Report ready in ${(report.durationMs / 1000).toFixed(1)}s · PDF + DOCX`,
      finishedAt,
      durationMs: report.durationMs,
      report,
    });
    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    publish({
      status: "error",
      stage: "error",
      progress: 100,
      message,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      error: message,
    });
    throw err;
  }
}

export async function persistReport(
  store: BenchStore,
  report: BenchReport,
  opts?: { skipDocuments?: boolean },
): Promise<string> {
  const dir = path.join(store.benchDir, "reports");
  await mkdir(dir, { recursive: true });

  if (!opts?.skipDocuments) {
    const { exportReportDocuments } = await import("./report-export.js");
    const paths = await exportReportDocuments(report, dir);
    report.exports = {
      pdf: paths.pdf,
      docx: paths.docx,
    };
  }

  const file = path.join(dir, `${report.reportId}.json`);
  await writeFile(file, JSON.stringify(report, null, 2), "utf8");
  await writeFile(
    path.join(dir, "latest.json"),
    JSON.stringify(
      {
        reportId: report.reportId,
        createdAt: report.createdAt,
        finishedAt: report.finishedAt,
        durationMs: report.durationMs,
        title: report.analysis.title,
        source: report.evidence.source,
        exports: report.exports
          ? {
              pdf: report.exports.pdf
                ? path.basename(report.exports.pdf)
                : undefined,
              docx: report.exports.docx
                ? path.basename(report.exports.docx)
                : undefined,
            }
          : undefined,
      },
      null,
      2,
    ),
    "utf8",
  );
  return file;
}

export async function loadReportExport(
  store: BenchStore,
  reportId: string,
  format: "pdf" | "docx",
): Promise<{ path: string; bytes: Buffer } | null> {
  if (!/^[\w.-]+$/.test(reportId)) return null;
  const file = path.join(store.benchDir, "reports", `${reportId}.${format}`);
  try {
    const bytes = await readFile(file);
    return { path: file, bytes };
  } catch {
    // Rebuild from JSON if the binary is missing.
    const report = await loadReport(store, reportId);
    if (!report) return null;
    const { exportReportDocuments } = await import("./report-export.js");
    const dir = path.join(store.benchDir, "reports");
    const paths = await exportReportDocuments(report, dir);
    const target = format === "pdf" ? paths.pdf : paths.docx;
    const bytes = await readFile(target);
    return { path: target, bytes };
  }
}

export async function loadReport(
  store: BenchStore,
  reportId: string,
): Promise<BenchReport | null> {
  if (!/^[\w.-]+$/.test(reportId)) return null;
  try {
    const raw = await readFile(
      path.join(store.benchDir, "reports", `${reportId}.json`),
      "utf8",
    );
    return JSON.parse(raw) as BenchReport;
  } catch {
    return null;
  }
}

export type ReportManager = {
  current: () => BenchReportProgress | null;
  start: (req: {
    compareId?: string;
    runId?: string;
  }) => { ok: true; reportId: string } | { ok: false; status: number; error: string };
  onProgress: (listener: (p: BenchReportProgress) => void) => () => void;
};

export function createReportManager(opts: {
  store: BenchStore;
}): ReportManager {
  let current: BenchReportProgress | null = null;
  let abort: AbortController | null = null;
  const listeners = new Set<(p: BenchReportProgress) => void>();

  const publish = (p: BenchReportProgress) => {
    current = p;
    for (const l of listeners) {
      try {
        l(p);
      } catch {
        /* ignore */
      }
    }
  };

  return {
    current: () => current,
    onProgress: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: (req) => {
      if (current?.status === "running") {
        return {
          ok: false,
          status: 409,
          error: "A report is already generating",
        };
      }
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal;
      const reportId = `report-${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString("hex")}`;
      const startedAt = new Date().toISOString();
      publish({
        reportId,
        status: "running",
        stage: "queued",
        progress: 1,
        message: "Queued…",
        startedAt,
      });
      // Fire-and-forget; progress streamed via listeners / SSE.
      void (async () => {
        const t0 = Date.now();
        try {
          // Re-implement thin wrapper so reportId stays stable for the client.
          publish({
            reportId,
            status: "running",
            stage: "resolve",
            progress: 5,
            message: "Resolving compare / run source…",
            startedAt,
          });
          const evidence = await buildReportEvidence(opts.store, {
            compareId: req.compareId,
            runId: req.runId,
            maxTraces: 8,
            signal,
            onTrace: (taskId) => {
              publish({
                reportId,
                status: "running",
                stage: "traces",
                progress: 35,
                message: `Digesting trajectory · ${taskId}`,
                startedAt,
              });
            },
          });
          publish({
            reportId,
            status: "running",
            stage: "stats",
            progress: 50,
            message: `Scorecard ready · ${evidence.charts.tasks.length} tasks`,
            startedAt,
          });
          publish({
            reportId,
            status: "running",
            stage: "analyze",
            progress: 62,
            message: "LLM synthesizing researcher report…",
            startedAt,
          });
          let analysis: ReportAnalysis;
          let provider = "offline";
          let model = "fallback";
          if (process.env.CLAI_REPORT_OFFLINE === "1") {
            analysis = fallbackAnalysis(evidence);
          } else {
            try {
              const llm = await analyzeEvidenceWithLlm(evidence, { signal });
              analysis = llm.analysis;
              provider = llm.provider;
              model = llm.model;
            } catch (err) {
              analysis = fallbackAnalysis(evidence);
              analysis.limitations = `${analysis.limitations} LLM error: ${
                err instanceof Error ? err.message : String(err)
              }`;
              provider = "fallback";
              model = "local-stats";
            }
          }
          publish({
            reportId,
            status: "running",
            stage: "assemble",
            progress: 88,
            message: "Assembling figures and paper sections…",
            startedAt,
          });
          const finishedAt = new Date().toISOString();
          const report: BenchReport = {
            reportId,
            createdAt: startedAt,
            finishedAt,
            durationMs: Date.now() - t0,
            provider,
            model,
            evidence,
            analysis,
          };
          publish({
            reportId,
            status: "running",
            stage: "export",
            progress: 92,
            message: "Writing PDF + DOCX…",
            startedAt,
          });
          await persistReport(opts.store, report);
          publish({
            reportId,
            status: "done",
            stage: "done",
            progress: 100,
            message: `Report ready in ${(report.durationMs / 1000).toFixed(1)}s · PDF + DOCX`,
            startedAt,
            finishedAt,
            durationMs: report.durationMs,
            report,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          publish({
            reportId,
            status: "error",
            stage: "error",
            progress: 100,
            message,
            startedAt,
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - t0,
            error: message,
          });
        }
      })();
      return { ok: true, reportId };
    },
  };
}

/** Exported for checks — pure scorecard math. */
export function __testUtils() {
  return { seriesFromRows, percentile, avg, fallbackAnalysis };
}
