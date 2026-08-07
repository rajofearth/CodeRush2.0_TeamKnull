/**
 * windows — approximate context-window sizes per provider/model.
 *
 * Used to set soft/hard compaction thresholds relative to the live model
 * instead of a single global token count. Override with CLAI_CONTEXT_WINDOW.
 */

import type { ProviderId } from "../adapter/providers.js";

/** Conservative defaults — prefer under-estimate over blowing the window. */
const PROVIDER_DEFAULT_WINDOW: Record<ProviderId, number> = {
  groq: 128_000,
  openrouter: 128_000,
  cerebras: 128_000,
  openai: 128_000,
  anthropic: 200_000,
  gemini: 128_000,
  gateway: 128_000,
  deepseek: 128_000,
};

/** Known model-id overrides (substring match, first hit wins). */
const MODEL_WINDOW_HINTS: Array<{ match: RegExp; tokens: number }> = [
  { match: /claude.*opus|claude-3-opus|claude-4/i, tokens: 200_000 },
  { match: /claude/i, tokens: 200_000 },
  { match: /gpt-4o|gpt-4\.1|o3|o4/i, tokens: 128_000 },
  { match: /gpt-oss/i, tokens: 128_000 },
  { match: /gemini.*1\.5|gemini.*2|gemini.*3|gemma/i, tokens: 128_000 },
  { match: /deepseek/i, tokens: 128_000 },
  { match: /llama.*405b|llama-4/i, tokens: 128_000 },
];

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envRatio(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
}

export type ContextWindowInfo = {
  windowTokens: number;
  /** Compact when estimated history ≥ this. */
  softThresholdTokens: number;
  /** Overflow / aggressive compact when ≥ this. */
  hardThresholdTokens: number;
  softRatio: number;
  hardRatio: number;
};

/**
 * Resolve the effective context window and soft/hard compact thresholds.
 * Soft defaults ~70% of window; hard ~90%. Absolute env threshold still
 * caps the soft trigger so small windows stay responsive.
 */
export function resolveContextWindow(opts: {
  provider?: ProviderId;
  modelId?: string;
}): ContextWindowInfo {
  const softRatio = envRatio("CLAI_COMPACT_SOFT_RATIO", 0.7);
  const hardRatio = envRatio("CLAI_COMPACT_HARD_RATIO", 0.9);

  let windowTokens = envInt("CLAI_CONTEXT_WINDOW", 0);
  if (!windowTokens) {
    if (opts.modelId) {
      for (const hint of MODEL_WINDOW_HINTS) {
        if (hint.match.test(opts.modelId)) {
          windowTokens = hint.tokens;
          break;
        }
      }
    }
    if (!windowTokens && opts.provider) {
      windowTokens = PROVIDER_DEFAULT_WINDOW[opts.provider];
    }
    if (!windowTokens) windowTokens = 128_000;
  }

  // Legacy absolute threshold still applies as a soft ceiling so existing
  // CLAI_COMPACT_THRESHOLD_TOKENS=45000 configs keep working.
  const absoluteSoft = envInt("CLAI_COMPACT_THRESHOLD_TOKENS", 45_000);
  const softThresholdTokens = Math.min(
    absoluteSoft,
    Math.floor(windowTokens * softRatio),
  );
  const hardThresholdTokens = Math.floor(windowTokens * hardRatio);

  return {
    windowTokens,
    softThresholdTokens,
    hardThresholdTokens,
    softRatio,
    hardRatio,
  };
}

/** Detect provider errors that mean the prompt exceeded the context window. */
export function isContextOverflowError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /context\s*(length|window)|maximum\s*context|token\s*limit|too\s*many\s*tokens|prompt\s*is\s*too\s*long|prompt\s*too\s*large|exceeds?\s*(the\s*)?(context|max).*length|max_tokens.*exceed|input\s*too\s*long|request\s*too\s*large|context_length_exceeded|string_above_max_length/i.test(
    message,
  );
}
