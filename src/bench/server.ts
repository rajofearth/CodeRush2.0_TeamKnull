/**
 * bench/server — live dashboard over plain node:http. Zero dependencies.
 *
 * Endpoints:
 *   GET /               self-contained dashboard page (dashboard.html)
 *   GET /events         SSE — latest LiveSnapshot on connect, then every update
 *   GET /api/runs       run summaries from history.jsonl (oldest first)
 *   GET /api/runs/:id   full BenchRunRecord for one run
 */

import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { BenchStore, LiveRunFeed } from "./store.js";

export const DEFAULT_BENCH_PORT = 4310;

export type BenchServerHandle = {
  port: number;
  url: string;
  close: () => Promise<void>;
};

export type StartBenchServerOptions = {
  store: BenchStore;
  live: LiveRunFeed;
  port?: number;
};

export async function startBenchServer(
  opts: StartBenchServerOptions,
): Promise<BenchServerHandle> {
  const htmlPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "dashboard.html",
  );
  const html = await readFile(htmlPath, "utf8");

  const sseClients = new Set<ServerResponse>();
  const unsubscribe = opts.live.subscribe((snapshot) => {
    const frame = `data: ${JSON.stringify({ type: "snapshot", snapshot })}\n\n`;
    for (const res of sseClients) res.write(frame);
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (url.pathname === "/events") {
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
        sseClients.add(res);
        const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
        req.on("close", () => {
          clearInterval(heartbeat);
          sseClients.delete(res);
        });
        return;
      }
      if (url.pathname === "/api/runs") {
        sendJson(res, 200, await opts.store.listRuns());
        return;
      }
      const runMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
      if (runMatch) {
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
    close: async () => {
      unsubscribe();
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
