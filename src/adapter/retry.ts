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
  /** Cancel backoff waits (and skip further retries) when aborted. */
  signal?: AbortSignal;
};

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((r) => setTimeout(r, ms));
  if (signal.aborted) {
    return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const DEFAULT_MAX_RETRIES = 4;
/** Short base for transient 5xx; quota/429 uses QUOTA_BASE_DELAY_MS instead. */
const DEFAULT_BASE_DELAY_MS = 2_000;
const QUOTA_BASE_DELAY_MS = 60_000;
const MAX_DELAY_MS = 120_000;

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
  const sleep =
    opts.sleep ?? ((ms: number) => sleepAbortable(ms, opts.signal));

  let attempt = 0;
  // attempts: 1 initial + maxRetries retries
  for (;;) {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    try {
      return await fn();
    } catch (err) {
      if (
        opts.signal?.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        throw err instanceof Error
          ? err
          : Object.assign(new Error("aborted"), { name: "AbortError" });
      }
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
          sticky: true,
          done: true,
        });
        throw new ProviderError(
          `rate limited / provider unavailable after ${maxRetries} retries: ${message.slice(0, 300)}`,
          classified.statusCode,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      const isQuota =
        classified.statusCode === 429 ||
        /quota exceeded|rate.?limit|resource.?exhausted|too many requests/i.test(
          message,
        );
      // Quota/429: wait ~1 minute (not 1–8s thrashing). Transient 5xx: shorter.
      const base = isQuota
        ? Math.max(opts.baseDelayMs ?? 0, QUOTA_BASE_DELAY_MS)
        : (opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
      const backoff = base * 2 ** (attempt - 1);
      const delayMs = jitter(Math.max(backoff, classified.retryAfterMs ?? 0));
      const secs = Math.max(1, Math.round(delayMs / 1000));
      const label = isQuota
        ? `quota / rate limited — waiting ${secs}s then retry (${attempt}/${maxRetries})`
        : `provider hiccup — retrying in ${secs}s (${attempt}/${maxRetries})`;
      opts.onStatus?.({
        label,
        detail: isQuota
          ? "Provider quota/rate limit — slowing down so we do not thrash the limit"
          : undefined,
        level: "warn",
        sticky: true,
      });
      await opts.onTrace?.({
        message: "provider_retry",
        attempt,
        maxRetries,
        delayMs,
        statusCode: classified.statusCode,
        quota: isQuota,
      });
      await sleep(delayMs);
    }
  }
}
