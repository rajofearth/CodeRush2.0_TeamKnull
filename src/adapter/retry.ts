/**
 * retry — provider-call resilience for the agent loop.
 *
 * 429 / 5xx / rate-limit errors get exponential backoff with jitter
 * (1s/2s/4s/8s base, max 4 retries), respecting `retry-after` when the
 * provider sends it. Non-retryable errors (401, invalid request, …) fail
 * fast with a clean message.
 */

import { APICallError } from "ai";

export type RetryStatusEvent = {
  label: string;
  detail?: string;
  level?: "info" | "warn" | "error";
  done?: boolean;
  /** Keep this in the activity log (matches UiEvent status.sticky). */
  sticky?: boolean;
};

export type RetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  onStatus?: (status: RetryStatusEvent) => void;
  onTrace?: (payload: Record<string, unknown>) => Promise<void> | void;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

type ErrorClass =
  | { kind: "retryable"; statusCode?: number; retryAfterMs?: number }
  | { kind: "fatal"; statusCode?: number; message: string };

function parseRetryAfter(headers: Record<string, string> | undefined): number | undefined {
  if (!headers) return undefined;
  const raw =
    headers["retry-after"] ?? headers["Retry-After"] ?? headers["RETRY-AFTER"];
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function classifyProviderError(err: unknown): ErrorClass {
  const message = err instanceof Error ? err.message : String(err);

  let statusCode: number | undefined;
  let headers: Record<string, string> | undefined;
  let sdkRetryable: boolean | undefined;

  if (APICallError.isInstance(err)) {
    statusCode = err.statusCode;
    headers = err.responseHeaders;
    sdkRetryable = err.isRetryable;
  } else if (err && typeof err === "object") {
    const rec = err as { statusCode?: unknown; status?: unknown };
    if (typeof rec.statusCode === "number") statusCode = rec.statusCode;
    else if (typeof rec.status === "number") statusCode = rec.status;
  }

  if (statusCode !== undefined) {
    if (statusCode === 429 || statusCode >= 500) {
      return {
        kind: "retryable",
        statusCode,
        retryAfterMs: parseRetryAfter(headers),
      };
    }
    // 400/401/403/404/422 … — retrying will not help.
    return { kind: "fatal", statusCode, message };
  }

  if (sdkRetryable) return { kind: "retryable" };

  if (/rate.?limit|too many requests|overloaded|quota exceeded|resource.?exhausted|\b429\b|\b50[023]\b|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message)) {
    return { kind: "retryable" };
  }
  return { kind: "fatal", message };
}

function jitter(ms: number): number {
  // Full base delay plus up to 25% random spread, capped.
  return Math.min(MAX_DELAY_MS, Math.round(ms * (1 + Math.random() * 0.25)));
}

/** Clean, user-facing failure for non-retryable provider errors. */
export class ProviderError extends Error {
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(statusCode ? `provider error ${statusCode}: ${message}` : `provider error: ${message}`);
    this.name = "ProviderError";
    this.statusCode = statusCode;
  }
}

export async function withProviderRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let attempt = 0;
  // attempts: 1 initial + maxRetries retries
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const classified = classifyProviderError(err);
      if (classified.kind === "fatal") {
        // Preserve structured SDK / programming errors (tool-schema validation,
        // etc.) so the agent loop can recover. Only normalize true provider
        // failures into ProviderError.
        if (
          classified.statusCode !== undefined ||
          APICallError.isInstance(err)
        ) {
          throw new ProviderError(
            classified.message.slice(0, 400),
            classified.statusCode,
          );
        }
        throw err;
      }
      attempt += 1;
      if (attempt > maxRetries) {
        const message = err instanceof Error ? err.message : String(err);
        opts.onStatus?.({
          label: "rate limited — giving up",
          detail: `${maxRetries} retries exhausted`,
          level: "error",
          done: true,
        });
        throw new ProviderError(
          `rate limited / provider unavailable after ${maxRetries} retries: ${message.slice(0, 300)}`,
          classified.statusCode,
        );
      }
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const delayMs = jitter(Math.max(backoff, classified.retryAfterMs ?? 0));
      const label = `rate limited — retrying in ${Math.round(delayMs / 1000)}s (${attempt}/${maxRetries})`;
      opts.onStatus?.({ label, level: "warn" });
      await opts.onTrace?.({
        message: "provider_retry",
        attempt,
        maxRetries,
        delayMs,
        statusCode: classified.statusCode,
      });
      await sleep(delayMs);
    }
  }
}
