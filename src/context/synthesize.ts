/**
 * context/synthesize — stage 0: raw user input → ContextRequest.
 *
 * Emits prompt_synthesis start/complete into the same context_stage stream
 * used by ContextManager.assemble(). The requestId minted here is the
 * correlation origin for the full 9-stage pipeline.
 */

import { randomUUID } from "node:crypto";
import type {
  ContextStageEmitter,
  ContextStageEvent,
  PromptSynthesisDetail,
} from "./stages.js";

export type SynthesizeCitation = {
  path: string;
  start?: number;
  end?: number;
};

export type SynthesizeSessionState = {
  runId: string;
  /** Explicit role from session (chat / explore / main / …). */
  agentRole?: string;
  tokenBudget?: number;
  memoryEnabled?: boolean;
  structuralCitationsEnabled?: boolean;
  /** Pre-known citations (e.g. demo fixtures); merged with inferred fragments. */
  citations?: SynthesizeCitation[];
  taskId?: string;
  emitStage?: ContextStageEmitter;
  /** Optional pinned requestId (tests / replay); otherwise minted here. */
  requestId?: string;
};

/** ContextRequest fields produced by stage 0 (requestId always set). */
export type SynthesizedContextRequest = {
  taskId: string;
  runId: string;
  requestId: string;
  tokenBudget: number;
  memoryEnabled: boolean;
  structuralCitationsEnabled: boolean;
  taskInstruction?: string;
  citations?: SynthesizeCitation[];
  agentRole?: string;
  emitStage?: ContextStageEmitter;
};

const PATH_LIKE =
  /(?:^|[\s"'`(])((?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z0-9]{1,12})/g;
const QUALIFIED_IDENT = /\b([A-Z][A-Za-z0-9]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\b/g;

function nowMs(): number {
  return Date.now();
}

function emitStageEvent(
  emit: ContextStageEmitter | undefined,
  event: ContextStageEvent,
): void {
  emit?.(event);
}

/** Pull path-like and Qualified.ident tokens from free text. */
export function inferTargetFragments(rawInput: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (frag: string) => {
    if (seen.has(frag)) return;
    seen.add(frag);
    found.push(frag);
  };
  for (const match of rawInput.matchAll(PATH_LIKE)) {
    const frag = match[1];
    if (frag) push(frag);
  }
  for (const match of rawInput.matchAll(QUALIFIED_IDENT)) {
    const frag = match[1];
    if (frag) push(frag);
  }
  return found;
}

/**
 * Light role inference when the session only carries a generic default.
 * Explicit non-default roles (chat, explore, …) are preserved.
 */
export function inferAgentRole(
  rawInput: string,
  sessionRole: string | undefined,
): { role: string; note?: string } {
  if (sessionRole && sessionRole !== "main") {
    return { role: sessionRole };
  }
  const lower = rawInput.toLowerCase();
  if (/\b(failing|failed|bug|broken|error|debug|stack\s*trace)\b/.test(lower)) {
    return {
      role: "debug",
      note: "agentRole set to 'debug' based on failure/debug keyword",
    };
  }
  if (/\b(explore|find|search|where\s+is|locate)\b/.test(lower)) {
    return {
      role: "explore",
      note: "agentRole set to 'explore' based on exploration keyword",
    };
  }
  return { role: sessionRole ?? "main" };
}

function citationRef(c: SynthesizeCitation): string {
  return c.start != null || c.end != null
    ? `${c.path}:${c.start ?? ""}-${c.end ?? ""}`
    : c.path;
}

/**
 * Build a ContextRequest from raw user input and emit prompt_synthesis events.
 * The returned request always has requestId set — pass it through to assemble().
 */
export function synthesizeContextRequest(
  rawInput: string,
  session: SynthesizeSessionState,
): SynthesizedContextRequest {
  const requestId = session.requestId ?? randomUUID().slice(0, 12);
  const runId = session.runId;
  const emit = session.emitStage;
  const startedAt = nowMs();

  emitStageEvent(emit, {
    type: "context_stage",
    runId,
    requestId,
    stage: "prompt_synthesis",
    status: "start",
    timestamp: startedAt,
    detail: {},
  });

  const extractionNotes: string[] = [];
  const freeTextQuery = rawInput;
  const tokenBudget = session.tokenBudget ?? 8000;
  const taskId =
    session.taskId ?? (rawInput.trim().slice(0, 80) || "turn");

  if (!session.taskId && rawInput.trim()) {
    extractionNotes.push(
      rawInput.trim().length > 80
        ? "taskId truncated from first 80 chars of raw input"
        : "taskId taken from raw input",
    );
  } else if (session.taskId) {
    extractionNotes.push(`taskId set to '${session.taskId}' from session`);
  }

  const { role: agentRole, note: roleNote } = inferAgentRole(
    rawInput,
    session.agentRole,
  );
  if (roleNote) {
    extractionNotes.push(roleNote);
  } else if (session.agentRole) {
    extractionNotes.push(`agentRole set to '${agentRole}' from session`);
  } else {
    extractionNotes.push("agentRole defaulted to 'main'");
  }

  extractionNotes.push(
    session.tokenBudget != null
      ? `tokenBudget set to ${tokenBudget} from session`
      : `tokenBudget set to ${tokenBudget} (default)`,
  );

  const inferred = inferTargetFragments(rawInput);
  const citations: SynthesizeCitation[] = [...(session.citations ?? [])];
  const existingPaths = new Set(citations.map((c) => c.path));
  for (const frag of inferred) {
    // Only promote path-like fragments into citations (Qualified.idents stay
    // in synthesizedQuery.targetFragments for glass, not as file citations).
    if (frag.includes("/") && !existingPaths.has(frag)) {
      citations.push({ path: frag });
      existingPaths.add(frag);
      extractionNotes.push(
        `inferred targetFragment '${frag}' from path-like token in input`,
      );
    } else if (!frag.includes("/")) {
      extractionNotes.push(
        `inferred targetFragment '${frag}' from qualified identifier in input`,
      );
    }
  }
  for (const c of session.citations ?? []) {
    extractionNotes.push(
      `targetFragment '${citationRef(c)}' from session citation`,
    );
  }

  const targetFragments = [
    ...citations.map(citationRef),
    ...inferred.filter((f) => !f.includes("/")),
  ];
  const seenFrag = new Set<string>();
  const uniqueFragments = targetFragments.filter((f) => {
    if (seenFrag.has(f)) return false;
    seenFrag.add(f);
    return true;
  });

  const synthesizedQuery: PromptSynthesisDetail["synthesizedQuery"] = {
    taskId,
    agentRole,
    targetFragments: uniqueFragments,
    freeTextQuery,
    tokenBudget,
  };

  const detail: PromptSynthesisDetail = {
    rawInput,
    synthesizedQuery,
    extractionNotes,
  };

  const completedAt = nowMs();
  emitStageEvent(emit, {
    type: "context_stage",
    runId,
    requestId,
    stage: "prompt_synthesis",
    status: "complete",
    timestamp: completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    detail: detail as unknown as Record<string, unknown>,
  });

  return {
    taskId,
    runId,
    requestId,
    tokenBudget,
    memoryEnabled: session.memoryEnabled ?? true,
    structuralCitationsEnabled: session.structuralCitationsEnabled ?? true,
    taskInstruction: freeTextQuery,
    citations: citations.length > 0 ? citations : undefined,
    agentRole,
    emitStage: emit,
  };
}
