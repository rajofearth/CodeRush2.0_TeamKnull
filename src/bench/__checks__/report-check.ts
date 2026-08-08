/**
 * Quick self-check for bench research reports.
 * Run: pnpm exec tsx src/bench/__checks__/report-check.ts
 *
 * Fast path is offline (evidence + fallback analysis).
 * With CLAI_REPORT_LIVE=1 and an API key, also asserts a full LLM report < 120s.
 */
import path from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  __testUtils,
  buildReportEvidence,
  createBenchReport,
  selectInterestingTaskIds,
  summarizeTraceFile,
} from "../report.js";
import { buildReportDocx, buildReportPdf } from "../report-export.js";
import { BenchStore } from "../store.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const store = new BenchStore(root);

const { seriesFromRows, percentile, fallbackAnalysis } = __testUtils();

// --- pure math ---
{
  assert(percentile([1, 2, 3, 4, 5], 50) === 3, "p50");
  assert(percentile([], 50) === 0, "empty p50");
  const s = seriesFromRows("clai", "t", [
    { id: "a", status: "pass", wallMs: 100, tokensIn: 10, tokensOut: 2, cost: 0.01 },
    { id: "b", status: "fail", wallMs: 200, tokensIn: 20, tokensOut: 4, cost: 0.02 },
    { id: "c", status: "error", wallMs: 50, tokensIn: 0, tokensOut: 0, cost: 0 },
  ]);
  assert(s.pass === 1 && s.fail === 1 && s.err === 1, "series counts");
  assert(s.total === 3 && Math.abs(s.rate - 1 / 3) < 1e-9, "series rate");
  assert(s.totalCost > 0.029 && s.totalCost < 0.031, "series cost");
}

// --- interesting task selection prefers disagreements ---
{
  const ids = selectInterestingTaskIds(
    {
      at: "2026-01-01",
      piProvider: "x",
      piModel: "y",
      clai: [
        { id: "same", status: "pass", wallMs: 10 },
        { id: "diff", status: "pass", wallMs: 10 },
      ],
      pi: [
        { id: "same", status: "pass", wallMs: 10 },
        { id: "diff", status: "error", wallMs: 10, detail: "stall" },
      ],
      piScore: { pass: 1, fail: 0, err: 1, total: 2, rate: 0.5 },
      claiScore: { pass: 2, fail: 0, err: 0, total: 2, rate: 1 },
    },
    null,
    2,
  );
  assert(ids[0] === "diff", `expected diff first, got ${ids.join(",")}`);
}

// --- evidence from real compare on disk ---
{
  const compare = await store.getCompare();
  assert(compare, "expected .clai/bench/compare-pi.json from prior runs");
  const evidence = await buildReportEvidence(store, {
    compareId: compare.compareId,
    maxTraces: 4,
  });
  assert(evidence.charts.series.length >= 1, "need at least one harness series");
  assert(evidence.charts.tasks.length >= 1, "need task rows");
  assert(evidence.facts.length >= 1, "need facts");
  const fb = fallbackAnalysis(evidence);
  assert(fb.title.length > 3, "fallback title");
  assert(fb.insights.length >= 1, "fallback insights");
  console.log(
    `evidence ok · ${evidence.charts.series.length} series · ${evidence.digests.length} digests · mode=${evidence.source.mode}`,
  );
}

// --- trace digester on a real file when present ---
{
  const compare = await store.getCompare();
  const runId = compare?.claiRunId;
  if (runId) {
    const run = await store.getRun(runId);
    const withTrace = run?.tasks.find((t) => t.tracePath);
    if (withTrace?.tracePath) {
      const digest = await summarizeTraceFile(withTrace.tracePath, {
        taskId: withTrace.id,
        status: withTrace.status,
        wallMs: withTrace.wallMs,
        toolCalls: withTrace.toolCalls,
      });
      assert(digest.timeline.length >= 1, "trace timeline");
      console.log(
        `trace ok · ${withTrace.id} · ${digest.timeline.length} beats · tools=${JSON.stringify(digest.toolCounts)}`,
      );
    }
  }
}

// --- offline full report path (no LLM) ---
{
  process.env.CLAI_REPORT_OFFLINE = "1";
  const t0 = Date.now();
  const report = await createBenchReport({
    store,
    compareId: (await store.getCompare())?.compareId,
    maxTraces: 3,
  });
  const ms = Date.now() - t0;
  assert(report.analysis.title, "report title");
  assert(report.evidence.charts.series.length >= 1, "report charts");
  assert(ms < 30_000, `offline report too slow: ${ms}ms`);
  assert(report.exports?.pdf, "pdf export path");
  assert(report.exports?.docx, "docx export path");
  await access(report.exports.pdf!);
  await access(report.exports.docx!);
  const pdfBuf = await buildReportPdf(report);
  const docxBuf = await buildReportDocx(report);
  assert(pdfBuf.length > 500, `pdf too small: ${pdfBuf.length}`);
  assert(docxBuf.length > 500, `docx too small: ${docxBuf.length}`);
  assert(pdfBuf.subarray(0, 4).toString() === "%PDF", "pdf magic");
  // DOCX is a zip
  assert(docxBuf[0] === 0x50 && docxBuf[1] === 0x4b, "docx zip magic");
  // Figures should discriminate on efficiency, not flat pass-rate bars.
  const { computeReportFigures } = await import("../report-figures.js");
  const figs = computeReportFigures(report.evidence.charts.series);
  assert(figs.composites.length === report.evidence.charts.series.length, "composites");
  assert(
    figs.metrics.some((m) => (m.avgWallMs || 0) > 0 || (m.avgTokens || 0) > 0),
    "avg metrics present",
  );
  console.log(
    `offline report ok · ${report.reportId} · ${(ms / 1000).toFixed(2)}s · ${report.provider}/${report.model}`,
  );
  console.log(
    `exports ok · pdf ${(pdfBuf.length / 1024).toFixed(1)}KB · docx ${(docxBuf.length / 1024).toFixed(1)}KB`,
  );
  delete process.env.CLAI_REPORT_OFFLINE;
}

// --- optional live LLM path ---
if (process.env.CLAI_REPORT_LIVE === "1") {
  delete process.env.CLAI_REPORT_OFFLINE;
  const t0 = Date.now();
  const stages: string[] = [];
  const report = await createBenchReport({
    store,
    compareId: (await store.getCompare())?.compareId,
    maxTraces: 5,
    onProgress: (p) => stages.push(`${p.stage}:${p.progress}`),
  });
  const ms = Date.now() - t0;
  assert(report.analysis.abstract.length > 40, "live abstract");
  assert(report.analysis.insights.length >= 2, "live insights");
  assert(ms < 120_000, `live report exceeded 2min: ${ms}ms`);
  if (report.provider === "fallback") {
    throw new Error(
      `expected live LLM provider, got fallback (${stages.join(" > ")}): ${report.analysis.limitations}`,
    );
  }
  console.log(
    `live report ok · ${report.reportId} · ${(ms / 1000).toFixed(1)}s · ${report.provider}/${report.model}`,
  );
  console.log(`title: ${report.analysis.title}`);
}

console.log("report-check: all passed");
