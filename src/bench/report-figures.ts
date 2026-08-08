/**
 * bench/report-figures — composite scores + per-task averages for reports.
 * Mirrors the dashboard scoreboard formula (pass / speed / tokens / cost).
 */

import type { ReportChartSeries, ReportHarness } from "./report.js";

export type ReportHarnessMetrics = {
  harness: ReportHarness;
  label: string;
  n: number;
  pass: number;
  passRate: number;
  avgWallMs: number;
  avgTokens: number | null;
  avgCost: number | null;
  totalCost: number;
  hasTok: boolean;
  hasCost: boolean;
};

export type ReportComposite = {
  harness: ReportHarness;
  total: number;
  wPass: number;
  wSpeed: number;
  wTok: number;
  wCost: number;
};

export type ReportFigures = {
  metrics: ReportHarnessMetrics[];
  composites: ReportComposite[];
  winner?: ReportHarness;
};

export function seriesToMetrics(series: ReportChartSeries[]): ReportHarnessMetrics[] {
  return series.map((s) => {
    const avgTokens =
      (Number(s.avgTokensIn) || 0) + (Number(s.avgTokensOut) || 0);
    const avgCost = s.total > 0 ? (Number(s.totalCost) || 0) / s.total : 0;
    return {
      harness: s.harness,
      label: s.label,
      n: s.total,
      pass: s.pass,
      passRate: s.rate,
      avgWallMs: s.avgWallMs,
      avgTokens: avgTokens > 0 ? avgTokens : null,
      avgCost: avgCost > 0 ? avgCost : null,
      totalCost: s.totalCost,
      hasTok: avgTokens > 0,
      hasCost: avgCost > 0,
    };
  });
}

function sharedWeights(metrics: ReportHarnessMetrics[]) {
  const bothTok = metrics.length > 0 && metrics.every((m) => m.hasTok);
  const bothCost = metrics.length > 0 && metrics.every((m) => m.hasCost);
  let wPass = 50;
  let wSpeed = 30;
  let wTok = 10;
  let wCost = 10;
  if (!bothTok && !bothCost) {
    wPass = 60;
    wSpeed = 40;
    wTok = 0;
    wCost = 0;
  } else if (!bothTok) {
    wPass = 55;
    wSpeed = 35;
    wTok = 0;
    wCost = 10;
  } else if (!bothCost) {
    wPass = 55;
    wSpeed = 35;
    wTok = 10;
    wCost = 0;
  }
  return { wPass, wSpeed, wTok, wCost };
}

export function computeReportFigures(
  series: ReportChartSeries[],
): ReportFigures {
  const metrics = seriesToMetrics(series);
  if (!metrics.length) return { metrics: [], composites: [] };

  const weights = sharedWeights(metrics);
  const walls = metrics.map((m) => m.avgWallMs).filter((n) => n > 0);
  const toks = metrics
    .map((m) => m.avgTokens)
    .filter((n): n is number => n != null && n > 0);
  const costs = metrics
    .map((m) => m.avgCost)
    .filter((n): n is number => n != null && n > 0);
  const refs = {
    bestAvgWall: walls.length ? Math.min(...walls) : 0,
    bestAvgTok: toks.length ? Math.min(...toks) : null,
    bestAvgCost: costs.length ? Math.min(...costs) : null,
  };

  const composites: ReportComposite[] = metrics.map((m) => {
    const passPts = weights.wPass * m.passRate;
    const speedPts =
      m.avgWallMs > 0 && refs.bestAvgWall > 0
        ? weights.wSpeed * Math.min(1, refs.bestAvgWall / m.avgWallMs)
        : 0;
    const tokPts =
      weights.wTok > 0 &&
      m.avgTokens != null &&
      m.avgTokens > 0 &&
      refs.bestAvgTok != null
        ? weights.wTok * Math.min(1, refs.bestAvgTok / m.avgTokens)
        : 0;
    const costPts =
      weights.wCost > 0 &&
      m.avgCost != null &&
      m.avgCost > 0 &&
      refs.bestAvgCost != null
        ? weights.wCost * Math.min(1, refs.bestAvgCost / m.avgCost)
        : 0;
    return {
      harness: m.harness,
      total: passPts + speedPts + tokPts + costPts,
      ...weights,
    };
  });

  const ranked = [...composites].sort((a, b) => b.total - a.total);
  const winner =
    ranked.length >= 2 && ranked[0]!.total > ranked[1]!.total + 0.05
      ? ranked[0]!.harness
      : ranked.length === 1
        ? ranked[0]!.harness
        : undefined;

  return { metrics, composites, winner };
}
