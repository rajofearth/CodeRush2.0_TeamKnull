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
        group: groups[event.tool],
      });
      return;
    }

    const id = pending.get(event.tool)?.shift() ?? nextEventId("tool");
    bus.emit({
      type: "tool_result",
      id,
      tool: event.tool,
      ok: event.ok ?? false,
      detail: event.detail ?? event.target,
      durationMs: event.durationMs,
    });
  };
}
