/**
 * ui-glass/model — reduce context_stage (+ surrounding) events into pane state.
 */

import {
  CONTEXT_STAGES,
  isContextStageEvent,
  stageHasFlags,
  type ContextStageEvent,
  type ContextStageName,
} from "../context/stages.js";

export type StageRowState = "idle" | "working" | "pass" | "flagged";

export type StageRow = {
  stage: ContextStageName;
  state: StageRowState;
  durationMs?: number;
  detail: Record<string, unknown>;
  summary: string;
};

export type GlassSessionStats = {
  requestsProcessed: number;
  totalStaleInvalidations: number;
  totalInjectionFlags: number;
};

export type GlassState = {
  runId: string | null;
  statusMessage: string;
  runComplete: boolean;
  requestId: string | null;
  trigger: string;
  agentRole: string;
  stages: StageRow[];
  stats: GlassSessionStats;
  /** Recent non-stage events used for trigger correlation. */
  recentTriggers: { ts: number; text: string }[];
};

export function emptyStages(): StageRow[] {
  return CONTEXT_STAGES.map((stage) => ({
    stage,
    state: "idle" as const,
    detail: {},
    summary: "",
  }));
}

export function initialGlassState(): GlassState {
  return {
    runId: null,
    statusMessage: "waiting for run…",
    runComplete: false,
    requestId: null,
    trigger: "",
    agentRole: "",
    stages: emptyStages(),
    stats: {
      requestsProcessed: 0,
      totalStaleInvalidations: 0,
      totalInjectionFlags: 0,
    },
    recentTriggers: [],
  };
}

export function formatStageSummary(
  stage: ContextStageName,
  detail: Record<string, unknown>,
): string {
  switch (stage) {
    case "query_planner": {
      const tiers = Array.isArray(detail.tiers) ? detail.tiers.join(",") : "";
      const targets = Array.isArray(detail.targetFragments)
        ? detail.targetFragments.length
        : 0;
      const role = String(detail.agentRole ?? "");
      return `tiers=[${tiers || "—"}] targets=${targets}${role ? ` role=${role}` : ""}`;
    }
    case "structural_retrieval": {
      const found = Number(detail.fragmentsFound ?? 0);
      const edges = Array.isArray(detail.edgesExpanded)
        ? (detail.edgesExpanded as { type: string; count: number }[])
            .map((e) => `${e.type}:${e.count}`)
            .join(",")
        : "";
      return `${found} fragment${found === 1 ? "" : "s"}${edges ? ` · ${edges}` : ""}`;
    }
    case "memory_retrieval": {
      const found = Number(detail.itemsFound ?? 0);
      const excl = Number(detail.excludedInvalidated ?? 0);
      return `${found} items · ${excl} invalidated excluded`;
    }
    case "relevance_scoring": {
      const count = Number(detail.candidateCount ?? 0);
      const top = Array.isArray(detail.topScored)
        ? (detail.topScored as { ref: string; score: number }[])[0]
        : undefined;
      const topStr = top
        ? `top: ${shortRef(top.ref)} (${top.score.toFixed(2)})`
        : "";
      return `${count} candidates scored${topStr ? `    ${topStr}` : ""}`;
    }
    case "stale_check": {
      const checked = Number(detail.checked ?? 0);
      const stale = Number(detail.staleFound ?? 0);
      if (stale > 0) {
        return `${checked} checked, ${stale} stale found → reindexed`;
      }
      return `${checked} checked, 0 stale`;
    }
    case "injection_scan": {
      const scanned = Number(detail.scanned ?? 0);
      const flagged = Array.isArray(detail.untrustedFlagged)
        ? (detail.untrustedFlagged as string[])
        : [];
      if (flagged.length > 0) {
        return `${scanned} scanned, ${flagged.length} untrusted flagged (${shortRef(flagged[0]!)})`;
      }
      return `${scanned} scanned, 0 untrusted`;
    }
    case "token_budget": {
      const budget = Number(detail.budget ?? 0);
      const included = Number(detail.included ?? 0);
      const excluded = Number(detail.excluded ?? 0);
      const used = Number(detail.tokensUsed ?? 0);
      return `budget ${budget} · ${included} in · ${excluded} out · ${used} tok`;
    }
    case "summarizer": {
      const demoted = Array.isArray(detail.demoted)
        ? (detail.demoted as { ref: string; level: string }[])
        : [];
      if (demoted.length === 0) return "no demotions";
      return `${demoted.length} demoted (${demoted.map((d) => `${shortRef(d.ref)}→${d.level}`).join(", ")})`;
    }
    default:
      return "";
  }
}

function shortRef(ref: string): string {
  if (ref.length <= 40) return ref;
  return `${ref.slice(0, 18)}…${ref.slice(-18)}`;
}

function eventTimestamp(event: Record<string, unknown>): number {
  if (typeof event.timestamp === "number") return event.timestamp;
  if (typeof event.ts === "string") {
    const t = Date.parse(event.ts);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

function extractTriggerText(event: Record<string, unknown>): string | null {
  // Direct user / plan shapes (UiEvent mirrored into JSONL or info wrappers)
  if (event.type === "user" && typeof event.text === "string") {
    return `user turn: '${truncate(event.text, 60)}'`;
  }
  if (event.type === "plan" && typeof event.title === "string") {
    return `plan: '${truncate(event.title, 60)}'`;
  }
  if (event.message === "context_compacted") {
    return "history compaction";
  }
  if (typeof event.prompt === "string" && event.type === "model_step") {
    return `user turn: '${truncate(event.prompt, 60)}'`;
  }
  if (event.event === "user" && typeof event.text === "string") {
    return `user turn: '${truncate(event.text, 60)}'`;
  }
  if (typeof event.text === "string" && event.type === "info") {
    // injection demo mirrors
    return `user turn: '${truncate(event.text, 60)}'`;
  }
  if (event.message === "subagent" || event.event === "subagent") {
    const agent = String(event.agent ?? event.scope ?? "task");
    return `task subagent: ${agent}`;
  }
  return null;
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n - 1)}…`;
}

function findTrigger(
  recent: { ts: number; text: string }[],
  aroundTs: number,
): string {
  if (recent.length === 0) return "";
  let best = recent[0]!;
  let bestDist = Math.abs(best.ts - aroundTs);
  for (const item of recent) {
    const d = Math.abs(item.ts - aroundTs);
    if (d < bestDist) {
      best = item;
      bestDist = d;
    }
  }
  // Prefer triggers that happened at or before the assemble
  const before = recent.filter((r) => r.ts <= aroundTs + 50);
  if (before.length > 0) {
    return before[before.length - 1]!.text;
  }
  return best.text;
}

export function reduceGlassEvent(
  state: GlassState,
  event: Record<string, unknown>,
): GlassState {
  const ts = eventTimestamp(event);

  // Track triggers from surrounding events
  const triggerText = extractTriggerText(event);
  let recentTriggers = state.recentTriggers;
  if (triggerText) {
    recentTriggers = [...state.recentTriggers, { ts, text: triggerText }].slice(
      -40,
    );
  }

  if (event.type === "run_start") {
    return {
      ...state,
      runComplete: false,
      statusMessage: `run ${String(event.runId ?? state.runId ?? "")} started`,
      recentTriggers,
      stages: emptyStages(),
      requestId: null,
      trigger: "",
      agentRole: "",
    };
  }

  if (event.type === "run_end") {
    return {
      ...state,
      runComplete: true,
      statusMessage: `run complete (${String(event.status ?? "ok")})`,
      recentTriggers,
    };
  }

  if (!isContextStageEvent(event)) {
    return { ...state, recentTriggers };
  }

  const stageEvent = event as ContextStageEvent;
  const stages = state.stages.map((row) => ({ ...row }));
  const idx = stages.findIndex((r) => r.stage === stageEvent.stage);
  if (idx < 0) return { ...state, recentTriggers };

  let stats = state.stats;
  let requestId = state.requestId;
  let trigger = state.trigger;
  let agentRole = state.agentRole;
  let stagesReset = stages;

  // New assemble request → reset pipeline rows
  if (
    stageEvent.status === "start" &&
    stageEvent.stage === "query_planner" &&
    stageEvent.requestId !== state.requestId
  ) {
    stagesReset = emptyStages();
    requestId = stageEvent.requestId;
    trigger = findTrigger(recentTriggers, stageEvent.timestamp);
    stats = {
      ...stats,
      requestsProcessed: stats.requestsProcessed + 1,
    };
  } else if (stageEvent.requestId !== state.requestId && state.requestId) {
    // Late event for a different request — still apply if it's the active one advancing
    requestId = stageEvent.requestId;
  }

  const row = stagesReset[idx]!;
  if (stageEvent.status === "start") {
    row.state = "working";
    row.detail = stageEvent.detail ?? {};
    row.summary = "";
  } else {
    row.detail = stageEvent.detail ?? {};
    row.durationMs = stageEvent.durationMs;
    row.summary = formatStageSummary(stageEvent.stage, row.detail);
    row.state = stageHasFlags(stageEvent.stage, row.detail) ? "flagged" : "pass";

    if (stageEvent.stage === "query_planner") {
      agentRole = String(row.detail.agentRole ?? agentRole);
    }
    if (stageEvent.stage === "stale_check") {
      stats = {
        ...stats,
        totalStaleInvalidations:
          stats.totalStaleInvalidations + Number(row.detail.staleFound ?? 0),
      };
    }
    if (stageEvent.stage === "injection_scan") {
      const flagged = Array.isArray(row.detail.untrustedFlagged)
        ? row.detail.untrustedFlagged.length
        : 0;
      stats = {
        ...stats,
        totalInjectionFlags: stats.totalInjectionFlags + flagged,
      };
    }
  }

  if (!trigger) {
    trigger = findTrigger(recentTriggers, stageEvent.timestamp);
  }

  return {
    ...state,
    recentTriggers,
    stages: stagesReset,
    stats,
    requestId,
    trigger,
    agentRole,
    runComplete: false,
    statusMessage: state.runId
      ? `watching ${state.runId}`
      : state.statusMessage,
  };
}
