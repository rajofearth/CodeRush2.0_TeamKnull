/**
 * bench/server — live dashboard over plain node:http. Zero dependencies.
 *
 * Endpoints:
 *   GET /               self-contained dashboard page (dashboard.html)
 *   GET /events         SSE — snapshot + compare + job events
 *   GET /api/runs       run summaries from history.jsonl (oldest first)
 *   GET /api/runs/:id   full BenchRunRecord for one run
 *   GET /api/compare    CLAI vs pi harness scorecard (compare-pi.json)
 *   GET /api/jobs/current
 *   POST /api/jobs      start clai | offline | compare
 *   POST /api/jobs/stop
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnvFiles } from "../adapter/env.js";
import { createJobManager, type JobManager } from "./jobs.js";
import type { BenchStore, LiveRunFeed } from "./store.js";

export const DEFAULT_BENCH_PORT = 4310;

export type BenchServerHandle = {
  port: number;
  url: string;
  close: () => Promise<void>;
  jobs: JobManager;
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
  });

  async function loadCompareFromDisk(): Promise<unknown | null> {
    try {
      const comparePath = path.join(opts.store.benchDir, "compare-pi.json");
      await access(comparePath);
      return JSON.parse(await readFile(comparePath, "utf8"));
    } catch {
      return jobs.getCompare();
    }
  }

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
      if (url.pathname === "/api/jobs/current" && method === "GET") {
        sendJson(res, 200, jobs.status());
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
      if (url.pathname === "/api/jobs" && method === "POST") {
        const body = (await readJsonBody(req)) as {
          kind?: string;
          parallel?: number;
          tasks?: string[];
          freshClai?: boolean;
        };
        const kind = body.kind;
        if (kind !== "clai" && kind !== "offline" && kind !== "compare") {
          sendJson(res, 400, {
            error: 'kind must be "clai" | "offline" | "compare"',
          });
          return;
        }
        const result = jobs.start({
          kind,
          parallel: body.parallel,
          tasks: body.tasks,
          freshClai: body.freshClai,
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
        const run = await opts.store.getRun(decodeURIComponent(runMatch[1]!));
        if (!run) {
          sendJson(res, 404, { error: "run not found" });
          return;
        }
        sendJson(res, 200, run);
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
    close: async () => {
      unsubscribeLive();
      unsubscribeCompare();
      unsubscribeStatus();
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
