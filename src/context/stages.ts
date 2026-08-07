/**
 * context/stages — glass-box observability types for context assembly.
 *
 * Nine named stages: prompt_synthesis (raw input → ContextRequest) then the
 * eight collect → fingerprint → label → budget stages inside assemble().
 * Events are append-only JSONL via TraceWriter.
 */

export const CONTEXT_STAGES = [
  "prompt_synthesis",
  "query_planner",
  "structural_retrieval",
  "memory_retrieval",
  "relevance_scoring",
  "stale_check",
  "injection_scan",
  "token_budget",
  "summarizer",
] as const;

export type ContextStageName = (typeof CONTEXT_STAGES)[number];

export type ContextStageStatus = "start" | "complete";

export interface ContextStageEvent {
  type: "context_stage";
  runId: string;
  requestId: string;
  stage: ContextStageName;
  status: ContextStageStatus;
  timestamp: number;
  durationMs?: number;
  detail: Record<string, unknown>;
}

export type ContextStageEmitter = (event: ContextStageEvent) => void;

/** Stage-specific detail shapes (documented for glass consumers). */
export type PromptSynthesisDetail = {
  rawInput: string;
  synthesizedQuery: {
    taskId: string;
    agentRole: string;
    targetFragments: string[];
    freeTextQuery: string;
    tokenBudget: number;
  };
  extractionNotes: string[];
};

export type QueryPlannerDetail = {
  tiers: string[];
  targetFragments: string[];
  agentRole: string;
};

export type StructuralRetrievalDetail = {
  fragmentsFound: number;
  edgesExpanded: { type: string; count: number }[];
};

export type MemoryRetrievalDetail = {
  tiersQueried: string[];
  itemsFound: number;
  excludedInvalidated: number;
};

export type RelevanceScoringDetail = {
  candidateCount: number;
  topScored: {
    ref: string;
    score: number;
    breakdown: Record<string, number>;
  }[];
};

export type StaleCheckDetail = {
  checked: number;
  staleFound: number;
  reindexed: string[];
  memoryInvalidated: string[];
};

export type InjectionScanDetail = {
  scanned: number;
  untrustedFlagged: string[];
};

export type TokenBudgetDetail = {
  budget: number;
  included: number;
  summarized: number;
  excluded: number;
  tokensUsed: number;
};

export type SummarizerDetail = {
  demoted: { ref: string; level: "file" | "module" }[];
};

/** True when a completed stage's detail warrants a ⚠ (repair) row in glass. */
export function stageHasFlags(
  stage: ContextStageName,
  detail: Record<string, unknown>,
): boolean {
  switch (stage) {
    case "stale_check":
      return Number(detail.staleFound ?? 0) > 0;
    case "injection_scan":
      return Array.isArray(detail.untrustedFlagged) && detail.untrustedFlagged.length > 0;
    case "token_budget":
      return Number(detail.excluded ?? 0) > 0 || Number(detail.summarized ?? 0) > 0;
    case "summarizer":
      return Array.isArray(detail.demoted) && detail.demoted.length > 0;
    default:
      return false;
  }
}

export function isContextStageEvent(value: unknown): value is ContextStageEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    e.type === "context_stage" &&
    typeof e.runId === "string" &&
    typeof e.requestId === "string" &&
    typeof e.stage === "string" &&
    (e.status === "start" || e.status === "complete") &&
    typeof e.timestamp === "number" &&
    typeof e.detail === "object" &&
    e.detail != null
  );
}
