/**
 * ui/bridge — adapt the tool plane's id-less `ToolPlaneEvent`s to UI events.
 *
 * The tool plane emits `tool_call` / `tool_result` pairs without a correlation
 * id, so we pair them here (most-recent pending call for that tool name) and
 * mint the ids the UI reducer needs.
 */

import type { UiBus } from "./events.js";
import { nextEventId } from "./events.js";

export type ToolPlaneLike = {
  type: "tool_call" | "tool_result";
  tool: string;
  target?: string;
  ok?: boolean;
  durationMs?: number;
  detail?: string;
  group?: string;
  input?: unknown;
  output?: unknown;
};

/** Read-only tools cluster into one collapsible block. */
const DEFAULT_GROUPS: Record<string, string> = {
  read: "explore",
  grep: "explore",
  glob: "explore",
};

export type ToolBridgeOptions = {
  /** tool name → group label. Pass `{}` to disable grouping. */
  groups?: Record<string, string>;
};

/** Prefer compact human sizes (`43KB`) over raw byte counts. */
export function formatHumanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} bytes`;
  if (bytes < 1024) return `${Math.round(bytes)} bytes`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return kb >= 10 || Number.isInteger(kb)
      ? `${Math.round(kb)}KB`
      : `${kb.toFixed(1)}KB`;
  }
  const mb = bytes / (1024 * 1024);
  return mb >= 10 || Number.isInteger(mb)
    ? `${Math.round(mb)}MB`
    : `${mb.toFixed(1)}MB`;
}

/**
 * Derive a useful `detail` string from tool `output` for the activity row.
 * Write/edit previews are `{ path, ok, detail }` where `detail` is bytes
 * (write) or replacement count / error string (edit).
 */
export function detailFromToolOutput(
  tool: string,
  output: unknown,
  fallback?: string,
): string | undefined {
  if (output != null && typeof output === "object" && !Array.isArray(output)) {
    const detail = (output as { detail?: unknown }).detail;
    if (typeof detail === "number" && Number.isFinite(detail)) {
      if (tool === "write") return formatHumanBytes(detail);
      if (tool === "edit") {
        return detail === 1 ? "1 replacement" : `${detail} replacements`;
      }
      return String(detail);
    }
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  }
  return fallback;
}

export function createToolPlaneBridge(
  bus: UiBus,
  opts: ToolBridgeOptions = {},
): (event: ToolPlaneLike) => void {
  const groups = opts.groups ?? DEFAULT_GROUPS;
  const pending = new Map<string, string[]>();

  return (event) => {
    if (event.type === "tool_call") {
      const id = nextEventId("tool");
      const queue = pending.get(event.tool) ?? [];
      queue.push(id);
      pending.set(event.tool, queue);
      bus.emit({
        type: "tool_call",
        id,
        tool: event.tool,
        target: event.target,
        group: event.group ?? groups[event.tool],
        input: event.input,
      });
      return;
    }

    const id = pending.get(event.tool)?.shift() ?? nextEventId("tool");
    const fromOutput = detailFromToolOutput(
      event.tool,
      event.output,
      event.detail ?? event.target,
    );
    bus.emit({
      type: "tool_result",
      id,
      tool: event.tool,
      ok: event.ok ?? false,
      // Prefer bytes / summary from output — don't leave detail stuck on the path.
      detail: fromOutput ?? event.detail ?? event.target,
      durationMs: event.durationMs,
      group: event.group,
      input: event.input,
      output: event.output,
    });
  };
}
