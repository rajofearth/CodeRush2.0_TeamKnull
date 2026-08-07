/**
 * trace — append-only JSONL session / run writer.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type TraceEventType =
  | "run_start"
  | "run_end"
  | "model_step"
  | "assistant_text"
  | "tool_call"
  | "tool_result"
  | "tool_repair"
  | "approval"
  | "error"
  | "info";

export type TraceEvent = {
  ts: string;
  runId: string;
  type: TraceEventType;
  [key: string]: unknown;
};

export type TraceWriter = {
  runId: string;
  path: string;
  append: (type: TraceEventType, payload?: Record<string, unknown>) => Promise<TraceEvent>;
  close: (status?: string, extra?: Record<string, unknown>) => Promise<void>;
};

export type CreateTraceWriterOptions = {
  runId?: string;
  /** Directory for events.jsonl (default: <tracesDir>/<runId>) */
  dir?: string;
  /** Workspace-rooted traces directory (default: <cwd>/.clai/traces) */
  tracesDir?: string;
  cwd?: string;
};

export async function createTraceWriter(
  opts: CreateTraceWriterOptions = {},
): Promise<TraceWriter> {
  const runId = opts.runId ?? randomUUID().slice(0, 8);
  const cwd = opts.cwd ?? process.cwd();
  const tracesDir = opts.tracesDir ?? path.join(cwd, ".clai", "traces");
  const dir = opts.dir ?? path.join(tracesDir, runId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "events.jsonl");

  const append: TraceWriter["append"] = async (type, payload = {}) => {
    const event: TraceEvent = {
      ts: new Date().toISOString(),
      runId,
      type,
      ...payload,
    };
    await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  };

  await append("run_start", { cwd });

  return {
    runId,
    path: filePath,
    append,
    close: async (status = "ok", extra = {}) => {
      await append("run_end", { status, ...extra });
    },
  };
}
