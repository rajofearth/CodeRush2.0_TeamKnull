/**
 * ui/events — the wire between producers (adapter, tools, verify, demo) and the TUI.
 *
 * Producers never touch React. They emit typed `UiEvent`s onto a `UiBus`; the Ink
 * shell subscribes and folds them into renderable items. The same bus feeds the
 * headless printer, so TTY and non-TTY paths stay in sync by construction.
 */

export type UiLevel = "info" | "warn" | "error";

export type PlanStepState = "pending" | "active" | "done" | "failed" | "skipped";

export type PlanStep = {
  id?: string;
  label: string;
  state?: PlanStepState;
  detail?: string;
};

export type UiEvent =
  /** A human turn. */
  | { type: "user"; id?: string; text: string }
  /**
   * Assistant prose. Repeated events sharing an `id` append (streaming);
   * set `done` on the final chunk to stop the caret.
   */
  | {
      type: "assistant";
      id?: string;
      text: string;
      done?: boolean;
    }
  /** Tool invocation started. `group` clusters sibling calls (e.g. "explore"). */
  | {
      type: "tool_call";
      id: string;
      tool: string;
      target?: string;
      group?: string;
    }
  /** Tool finished. `id` should match the originating `tool_call`. */
  | {
      type: "tool_result";
      id: string;
      tool?: string;
      ok: boolean;
      detail?: string;
      durationMs?: number;
    }
  /** Plan / task-graph snapshot. Re-emitting the same `id` replaces it. */
  | {
      type: "plan";
      id?: string;
      title?: string;
      revision?: number;
      steps: PlanStep[];
    }
  /** Todo list snapshot — same shape as plan, rendered with checkboxes. */
  | {
      type: "todo";
      id?: string;
      title?: string;
      steps: PlanStep[];
    }
  /** Approval gate. Re-emit with the same `id` plus `decision` to resolve it. */
  | {
      type: "approval";
      id: string;
      tool: string;
      request: string;
      reason?: string;
      decision?: "allowed" | "denied" | "auto";
    }
  /** Verification outcome (checks, tests, task-graph gates). */
  | {
      type: "verify";
      id?: string;
      label: string;
      ok: boolean;
      detail?: string;
      logPath?: string;
    }
  /**
   * Process label for the working line. Not hidden chain-of-thought — a short
   * phrase describing what the harness is doing. `done: true` clears it.
   */
  | {
      type: "status";
      id?: string;
      label: string;
      detail?: string;
      level?: UiLevel;
      done?: boolean;
      /** Keep this in the activity log instead of only on the working line. */
      sticky?: boolean;
    }
  /** Header numbers. Partial — only provided fields overwrite. */
  | {
      type: "metrics";
      tokensIn?: number;
      tokensOut?: number;
      contextPct?: number;
      costUsd?: number;
    }
  /** Ambient run facts for the context strip / footer. Partial merge. */
  | {
      type: "context";
      title?: string;
      agent?: string;
      model?: string;
      cwd?: string;
      runId?: string;
      sandboxMode?: string;
      tracePath?: string;
      mcp?: string[];
      lsp?: string[];
      memoryInjected?: number;
      memoryDropped?: number;
    };

export type UiEventType = UiEvent["type"];

export type UiBus = {
  emit: (event: UiEvent) => void;
  subscribe: (listener: (event: UiEvent) => void) => () => void;
  /** Events emitted before the first subscriber attached, replayed on subscribe. */
  buffered: () => UiEvent[];
};

export function createUiBus(): UiBus {
  const listeners = new Set<(event: UiEvent) => void>();
  const backlog: UiEvent[] = [];

  return {
    emit(event) {
      if (listeners.size === 0) backlog.push(event);
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      const replay = backlog.splice(0, backlog.length);
      listeners.add(listener);
      for (const event of replay) listener(event);
      return () => listeners.delete(listener);
    },
    buffered: () => backlog.slice(),
  };
}

let idSeq = 0;
export function nextEventId(prefix = "ev"): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}
