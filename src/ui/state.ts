/**
 * ui/state — fold a `UiEvent` stream into the flat, ordered item list the
 * activity column renders. Pure and React-free so it can be unit-tested and
 * reused by the headless printer.
 */

import type { PlanStep, UiEvent, UiLevel } from "./events.js";

export type ToolStatus = "pending" | "ok" | "fail";

export type UserItem = { kind: "user"; id: string; text: string };
export type AssistantItem = {
  kind: "assistant";
  id: string;
  text: string;
  done: boolean;
};
export type ThinkingItem = {
  kind: "thinking";
  id: string;
  text: string;
  done: boolean;
};
export type ToolItem = {
  kind: "tool";
  id: string;
  tool: string;
  target?: string;
  group?: string;
  status: ToolStatus;
  detail?: string;
  durationMs?: number;
};
export type PlanItem = {
  kind: "plan";
  id: string;
  variant: "plan" | "todo";
  title?: string;
  revision?: number;
  steps: PlanStep[];
};
export type ApprovalItem = {
  kind: "approval";
  id: string;
  tool: string;
  request: string;
  reason?: string;
  decision?: "allowed" | "denied" | "auto";
};
export type VerifyItem = {
  kind: "verify";
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  logPath?: string;
};
export type NoteItem = {
  kind: "note";
  id: string;
  label: string;
  detail?: string;
  level: UiLevel;
};

export type ActivityItem =
  | UserItem
  | AssistantItem
  | ThinkingItem
  | ToolItem
  | PlanItem
  | ApprovalItem
  | VerifyItem
  | NoteItem;

/** Seal any open thinking blocks (e.g. when tools or reply prose start). */
function sealOpenThinking(items: ActivityItem[]): ActivityItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.kind === "thinking" && !item.done) {
      changed = true;
      return { ...item, done: true };
    }
    return item;
  });
  return changed ? next : items;
}

export type RunMetrics = {
  tokensIn: number;
  tokensOut: number;
  contextPct?: number;
  costUsd?: number;
};

export type RunContext = {
  title?: string;
  agent?: string;
  model?: string;
  cwd?: string;
  runId?: string;
  sandboxMode?: string;
  tracePath?: string;
  mcp: string[];
  lsp: string[];
  memoryInjected?: number;
  memoryDropped?: number;
};

export type UiState = {
  items: ActivityItem[];
  metrics: RunMetrics;
  context: RunContext;
  /** Transient working line; null when idle. */
  status: { label: string; detail?: string; level: UiLevel } | null;
};

export function initialUiState(seed?: Partial<RunContext>): UiState {
  return {
    items: [],
    metrics: { tokensIn: 0, tokensOut: 0 },
    context: { mcp: [], lsp: [], ...seed },
    status: null,
  };
}

let anonSeq = 0;
function anonId(prefix: string): string {
  anonSeq += 1;
  return `${prefix}~${anonSeq}`;
}

function replaceById(
  items: ActivityItem[],
  id: string,
  next: ActivityItem,
): ActivityItem[] {
  const at = items.findIndex((item) => item.id === id);
  if (at < 0) return [...items, next];
  const copy = items.slice();
  copy[at] = next;
  return copy;
}

/** Apply one event. Returns a new state (never mutates the input). */
export function reduceUiEvent(state: UiState, event: UiEvent): UiState {
  switch (event.type) {
    case "user":
      return {
        ...state,
        items: [
          ...state.items,
          { kind: "user", id: event.id ?? anonId("user"), text: event.text },
        ],
      };

    case "assistant": {
      const id = event.id ?? anonId("asst");
      const items = sealOpenThinking(state.items);
      const last = items[items.length - 1];
      // Streaming / seal against the open tail (same id or a prior ~cont-*).
      if (
        last?.kind === "assistant" &&
        (last.id === id || last.id.startsWith(`${id}~cont-`))
      ) {
        const next: AssistantItem = {
          kind: "assistant",
          id: last.id,
          text: last.text + event.text,
          done: event.done ?? last.done,
        };
        return { ...state, items: replaceById(items, last.id, next) };
      }
      const existing = items.find(
        (item): item is AssistantItem =>
          item.kind === "assistant" && item.id === id,
      );
      // Same id reused after tools/notes intervened — do not replaceById in place.
      if (existing) {
        let n = 1;
        while (items.some((item) => item.id === `${id}~cont-${n}`)) {
          n += 1;
        }
        const contId = `${id}~cont-${n}`;
        const next: AssistantItem = {
          kind: "assistant",
          id: contId,
          text: event.text,
          done: event.done ?? false,
        };
        return { ...state, items: [...items, next] };
      }
      const next: AssistantItem = {
        kind: "assistant",
        id,
        text: event.text,
        done: event.done ?? false,
      };
      return { ...state, items: [...items, next] };
    }

    case "thinking": {
      const id = event.id ?? anonId("think");
      const existing = state.items.find(
        (item): item is ThinkingItem =>
          item.kind === "thinking" && item.id === id,
      );
      const next: ThinkingItem = {
        kind: "thinking",
        id,
        text: (existing?.text ?? "") + event.text,
        done: event.done ?? existing?.done ?? false,
      };
      return { ...state, items: replaceById(state.items, id, next) };
    }

    case "tool_call":
      return {
        ...state,
        items: [
          ...sealOpenThinking(state.items),
          {
            kind: "tool",
            id: event.id,
            tool: event.tool,
            target: event.target,
            group: event.group,
            status: "pending",
          },
        ],
      };

    case "tool_result": {
      const existing = state.items.find(
        (item): item is ToolItem => item.kind === "tool" && item.id === event.id,
      );
      const next: ToolItem = {
        kind: "tool",
        id: event.id,
        tool: event.tool ?? existing?.tool ?? "tool",
        target: existing?.target,
        group: existing?.group,
        status: event.ok ? "ok" : "fail",
        detail: event.detail ?? existing?.detail,
        durationMs: event.durationMs,
      };
      return { ...state, items: replaceById(state.items, event.id, next) };
    }

    case "plan":
    case "todo": {
      const id = event.id ?? (event.type === "todo" ? "todo" : "plan");
      const next: PlanItem = {
        kind: "plan",
        id,
        variant: event.type,
        title: event.title,
        revision: event.type === "plan" ? event.revision : undefined,
        steps: event.steps,
      };
      return { ...state, items: replaceById(state.items, id, next) };
    }

    case "approval": {
      const next: ApprovalItem = {
        kind: "approval",
        id: event.id,
        tool: event.tool,
        request: event.request,
        reason: event.reason,
        decision: event.decision,
      };
      return { ...state, items: replaceById(state.items, event.id, next) };
    }

    case "verify": {
      const id = event.id ?? anonId("verify");
      const next: VerifyItem = {
        kind: "verify",
        id,
        label: event.label,
        ok: event.ok,
        detail: event.detail,
        logPath: event.logPath,
      };
      return { ...state, items: replaceById(state.items, id, next) };
    }

    case "status": {
      const level = event.level ?? "info";
      const items = event.sticky
        ? [
            ...state.items,
            {
              kind: "note" as const,
              id: event.id ?? anonId("note"),
              label: event.label,
              detail: event.detail,
              level,
            },
          ]
        : state.items;
      return {
        ...state,
        items,
        status: event.done
          ? null
          : { label: event.label, detail: event.detail, level },
      };
    }

    case "metrics":
      return {
        ...state,
        metrics: {
          tokensIn: event.tokensIn ?? state.metrics.tokensIn,
          tokensOut: event.tokensOut ?? state.metrics.tokensOut,
          contextPct: event.contextPct ?? state.metrics.contextPct,
          costUsd: event.costUsd ?? state.metrics.costUsd,
        },
      };

    case "context": {
      const { type: _ignored, mcp, lsp, ...rest } = event;
      const merged: RunContext = { ...state.context };
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
      if (mcp) merged.mcp = mcp;
      if (lsp) merged.lsp = lsp;
      return { ...state, context: merged };
    }

    default:
      return state;
  }
}

/**
 * Consecutive tool rows sharing a non-empty `group` collapse into one block so
 * a 12-file explore pass reads as a single line plus children.
 */
export type RenderBlock =
  | { kind: "single"; item: ActivityItem }
  | { kind: "toolGroup"; id: string; group: string; items: ToolItem[] };

export function groupItems(items: ActivityItem[]): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  for (const item of items) {
    if (item.kind === "tool" && item.group) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "toolGroup" && last.group === item.group) {
        last.items.push(item);
        continue;
      }
      blocks.push({
        kind: "toolGroup",
        id: `group-${item.id}`,
        group: item.group,
        items: [item],
      });
      continue;
    }
    blocks.push({ kind: "single", item });
  }
  return blocks;
}
