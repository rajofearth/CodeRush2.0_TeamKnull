/**
 * bench/server — live dashboard over plain node:http. Zero dependencies.
 *
 * Endpoints:
 *   GET /               self-contained dashboard page (dashboard.html)
 *   GET /events         SSE — snapshot + compare + job + report events
 *   GET /api/runs       run summaries from history.jsonl (oldest first)
 *   GET /api/runs/:id   full BenchRunRecord for one run
 *   GET /api/compare    CLAI vs pi (+ Codex when mode=all) scorecard (latest compare-pi.json)
 *   GET /api/compare/:id archived compare scorecard
 *   GET /api/tasks      catalog ids + count
 *   GET /api/jobs/current
 *   POST /api/jobs      start clai | offline | compare ({ limit?, parallel?, sideParallel?, resume?, … })
 *   POST /api/jobs/stop
 *   POST /api/report    start AI research report ({ compareId?, runId? })
 *   GET /api/report/current
 *   GET /api/report/:id finished report JSON
 *   GET /api/report/:id.pdf | :id.docx  download generated documents
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnvFiles } from "../adapter/env.js";
import { createJobManager, type JobManager } from "./jobs.js";
import {
  createReportManager,
  loadReport,
  loadReportExport,
  type ReportManager,
} from "./report.js";
import type { BenchStore, LiveRunFeed } from "./store.js";

export const DEFAULT_BENCH_PORT = 4310;

export type BenchServerHandle = {
  port: number;
  url: string;
  close: () => Promise<void>;
  jobs: JobManager;
  reports: ReportManager;
};

export type StartBenchServerOptions = {
  store: BenchStore;
  live: LiveRunFeed;
  port?: number;
  /** Package / repo root for jobs (defaults to store parent of .clai/bench). */
  workspaceRoot?: string;
};

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export async function startBenchServer(
  opts: StartBenchServerOptions,
): Promise<BenchServerHandle> {
  await loadEnvFiles();

  const htmlPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "dashboard.html",
  );
  const loadDashboardHtml = () => readFile(htmlPath, "utf8");

  const workspaceRoot =
    opts.workspaceRoot ?? path.resolve(opts.store.benchDir, "../..");

  const jobs = createJobManager({
    workspaceRoot,
    store: opts.store,
    live: opts.live,
  });
  const reports = createReportManager({ store: opts.store });

  const sseClients = new Set<ServerResponse>();
  const broadcast = (payload: unknown) => {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) res.write(frame);
  };

  const unsubscribeLive = opts.live.subscribe((snapshot) => {
    broadcast({ type: "snapshot", snapshot });
  });
  const unsubscribeCompare = jobs.onCompare((compare) => {
    broadcast({ type: "compare", compare });
  });
  const unsubscribeStatus = jobs.onStatus((job) => {
    broadcast({ type: "job", job });
    // Auto-generate research report when a CLAI or compare run finishes cleanly.
    if (
      job.status === "idle" &&
      (job.kind === "clai" || job.kind === "compare") &&
      !job.error
    ) {
      const running = reports.current();
      if (running?.status === "running") return;
      const compare = jobs.getCompare() as {
        compareId?: string;
        claiRunId?: string;
        partial?: boolean;
      } | null;
      if (job.kind === "compare") {
        if (compare?.partial) return;
        const result = reports.start({
          compareId: compare?.compareId,
          runId: compare?.claiRunId,
        });
        if (result.ok) broadcast({ type: "report", report: reports.current() });
        return;
      }
      const snap = opts.live.current();
      if (!snap?.done || !snap.runId) return;
      const result = reports.start({ runId: snap.runId });
      if (result.ok) broadcast({ type: "report", report: reports.current() });
    }
  });
  const unsubscribeReport = reports.onProgress((report) => {
    broadcast({ type: "report", report });
  });

  async function loadCompareFromDisk(): Promise<unknown | null> {
    const mem = jobs.getCompare() as { at?: string; partial?: boolean } | null;
    const job = jobs.status();
    const compareInFlight =
      job.kind === "compare" &&
      (job.status === "running" || job.status === "stopping");
    // While a compare job is in flight, serve memory only: partial seed/mid-race,
    // or the final card emitted before jobs.finish() flips status to idle.
    // jobs.start seeds partial before setStatus so this never flashes a prior finish.
    if (compareInFlight) {
      return mem;
    }
    try {
      const disk = await opts.store.getCompare();
      if (
        mem &&
        mem.partial !== true &&
        (mem as { at?: string }).at &&
        disk?.at &&
        Date.parse((mem as { at: string }).at) >= Date.parse(disk.at)
      ) {
        return mem;
      }
      return disk ?? mem;
    } catch {
      return mem;
    }
  }

  // Import legacy compare-pi.json into compares/ so history can replay dual charts.
  void opts.store.getCompare();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = (req.method ?? "GET").toUpperCase();
    try {
      if (url.pathname === "/" && method === "GET") {
        const html = await loadDashboardHtml();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (url.pathname === "/events" && method === "GET") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write("retry: 2000\n\n");
        const current = opts.live.current();
        if (current) {
          res.write(
            `data: ${JSON.stringify({ type: "snapshot", snapshot: current })}\n\n`,
          );
        }
        const compare = await loadCompareFromDisk();
        if (compare) {
          res.write(
            `data: ${JSON.stringify({ type: "compare", compare })}\n\n`,
          );
        }
        res.write(
          `data: ${JSON.stringify({ type: "job", job: jobs.status() })}\n\n`,
        );
        const reportProg = reports.current();
        if (reportProg) {
          res.write(
            `data: ${JSON.stringify({ type: "report", report: reportProg })}\n\n`,
          );
        }
        sseClients.add(res);
        const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
        const jobPoll = setInterval(() => {
          res.write(
            `data: ${JSON.stringify({ type: "job", job: jobs.status() })}\n\n`,
          );
        }, 2000);
        req.on("close", () => {
          clearInterval(heartbeat);
          clearInterval(jobPoll);
          sseClients.delete(res);
        });
        return;
      }
      if (url.pathname === "/api/runs" && method === "GET") {
        sendJson(res, 200, await opts.store.listRuns());
        return;
      }
      if (url.pathname === "/api/compare" && method === "GET") {
        const compare = await loadCompareFromDisk();
        if (!compare) {
          sendJson(res, 404, { error: "compare-pi.json not found" });
          return;
        }
        sendJson(res, 200, compare);
        return;
      }
      const compareMatch = /^\/api\/compare\/([^/]+)$/.exec(url.pathname);
      if (compareMatch && method === "GET") {
        const id = decodeURIComponent(compareMatch[1]!);
        const compare = await opts.store.getCompare(id);
        if (!compare) {
          sendJson(res, 404, { error: "compare not found" });
          return;
        }
        sendJson(res, 200, compare);
        return;
      }
      if (url.pathname === "/api/jobs/current" && method === "GET") {
        sendJson(res, 200, jobs.status());
        return;
      }
      if (url.pathname === "/api/report/current" && method === "GET") {
        const cur = reports.current();
        if (!cur) {
          sendJson(res, 404, { error: "no report in progress" });
          return;
        }
        sendJson(res, 200, cur);
        return;
      }
      if (url.pathname === "/api/report" && method === "POST") {
        const body = (await readJsonBody(req)) as {
          compareId?: string;
          runId?: string;
        };
        const result = reports.start({
          compareId: body.compareId,
          runId: body.runId,
        });
        if (!result.ok) {
          sendJson(res, result.status, { error: result.error });
          return;
        }
        broadcast({ type: "report", report: reports.current() });
        sendJson(res, 202, { ok: true, reportId: result.reportId, report: reports.current() });
        return;
      }
      const reportFileMatch =
        /^\/api\/report\/([^/]+)\.(pdf|docx)$/i.exec(url.pathname);
      if (reportFileMatch && method === "GET") {
        const id = decodeURIComponent(reportFileMatch[1]!);
        const format = reportFileMatch[2]!.toLowerCase() as "pdf" | "docx";
        const file = await loadReportExport(opts.store, id, format);
        if (!file) {
          sendJson(res, 404, { error: "report export not found" });
          return;
        }
        const type =
          format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        res.writeHead(200, {
          "content-type": type,
          "content-disposition": `attachment; filename="${id}.${format}"`,
          "content-length": file.bytes.length,
          "cache-control": "no-cache",
        });
        res.end(file.bytes);
        return;
      }
      const reportMatch = /^\/api\/report\/([^/]+)$/.exec(url.pathname);
      if (reportMatch && method === "GET") {
        const id = decodeURIComponent(reportMatch[1]!);
        const cur = reports.current();
        if (cur?.reportId === id && cur.report) {
          sendJson(res, 200, cur.report);
          return;
        }
        const loaded = await loadReport(opts.store, id);
        if (!loaded) {
          sendJson(res, 404, { error: "report not found" });
          return;
        }
        sendJson(res, 200, loaded);
        return;
      }
      if (url.pathname === "/api/jobs/stop" && method === "POST") {
        const result = jobs.stop();
        broadcast({ type: "job", job: jobs.status() });
        if (!result.ok) {
          sendJson(res, 400, { error: result.error });
          return;
        }
        sendJson(res, 200, { ok: true, job: jobs.status() });
        return;
      }
      if (url.pathname === "/api/tasks" && method === "GET") {
        const { loadBenchTasks, resolveBenchFixturesRoot } = await import(
          "./index.js"
        );
        const catalog = await loadBenchTasks(resolveBenchFixturesRoot());
        sendJson(res, 200, {
          count: catalog.length,
          ids: catalog.map((t) => t.id),
        });
        return;
      }
      if (url.pathname === "/api/jobs" && method === "POST") {
        const body = (await readJsonBody(req)) as {
          kind?: string;
          parallel?: number;
          sideParallel?: number;
          tasks?: string[];
          limit?: number;
          freshClai?: boolean;
          resume?: boolean;
        };
        const kind = body.kind;
        if (kind !== "clai" && kind !== "offline" && kind !== "compare") {
          sendJson(res, 400, {
            error: 'kind must be "clai" | "offline" | "compare"',
          });
          return;
        }
        const limit =
          body.limit != null && Number.isFinite(Number(body.limit))
            ? Math.max(1, Math.floor(Number(body.limit)))
            : undefined;
        const sideParallel =
          body.sideParallel != null && Number.isFinite(Number(body.sideParallel))
            ? Math.max(1, Math.floor(Number(body.sideParallel)))
            : undefined;
        const parallel =
          body.parallel != null && Number.isFinite(Number(body.parallel))
            ? Math.max(1, Math.floor(Number(body.parallel)))
            : undefined;
        const result = jobs.start({
          kind,
          parallel,
          sideParallel,
          tasks: body.tasks,
          limit,
          freshClai: body.freshClai,
          resume: body.resume === true,
        });
        broadcast({ type: "job", job: jobs.status() });
        if (!result.ok) {
          sendJson(res, result.status, { error: result.error });
          return;
        }
        sendJson(res, 202, { ok: true, job: jobs.status() });
        return;
      }
      const runMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
      if (runMatch && method === "GET") {
        const id = decodeURIComponent(runMatch[1]!);
        const run = await opts.store.getRun(id);
        if (!run) {
          sendJson(res, 404, { error: "run not found" });
          return;
        }
        let linkedCompare = run.compare ?? null;
        if (!linkedCompare) {
          linkedCompare = await opts.store.findCompareForRun(id);
        }
        sendJson(res, 200, {
          ...run,
          compare: linkedCompare || undefined,
          compareId: run.compareId || (linkedCompare as { compareId?: string } | null)?.compareId,
        });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const port = opts.port ?? DEFAULT_BENCH_PORT;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    jobs,
    reports,
    close: async () => {
      unsubscribeLive();
      unsubscribeCompare();
      unsubscribeStatus();
      unsubscribeReport();
      jobs.stop();
      for (const res of sseClients) res.end();
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
