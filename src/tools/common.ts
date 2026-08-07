/**
 * Shared tool-plane types and path helpers (no tool implementations).
 */

import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import type { SandboxHandle } from "../sandbox/index.js";
import type { ShellJobManager } from "../shell/jobs.js";
import type { TraceWriter } from "../trace/index.js";

export type ToolContext = {
  workspaceRoot: string;
  sandbox: SandboxHandle;
  trace?: TraceWriter;
  onEvent?: (event: ToolPlaneEvent) => void;
  /** Session-scoped background shell jobs (bash_bg / bash_jobs / …). */
  shellJobs?: ShellJobManager;
};

export type ToolPlaneEvent = {
  type: "tool_call" | "tool_result";
  tool: string;
  target?: string;
  ok?: boolean;
  durationMs?: number;
  detail?: string;
  input?: unknown;
  output?: unknown;
  /** Cluster label for the UI (e.g. "subagent" for task sub-loop calls). */
  group?: string;
};

export type ToolResult = {
  ok: boolean;
  tool: string;
  [key: string]: unknown;
};

export function resolveInWorkspace(root: string, relOrAbs: string): string {
  const rootAbs = path.resolve(root);
  const resolved = path.isAbsolute(relOrAbs)
    ? path.resolve(relOrAbs)
    : path.resolve(rootAbs, relOrAbs);
  const rel = path.relative(rootAbs, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes workspace: ${relOrAbs}`);
  }
  return resolved;
}

export async function emitToolEvent(
  ctx: ToolContext,
  phase: "tool_call" | "tool_result",
  toolName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const event: ToolPlaneEvent = {
    type: phase,
    tool: toolName,
    ...payload,
  } as ToolPlaneEvent;
  ctx.onEvent?.(event);
  if (ctx.trace) {
    await ctx.trace.append(phase, { tool: toolName, ...payload });
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
