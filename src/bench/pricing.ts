/**
 * Published provider USD rates (per 1M tokens) used for bench cost columns.
 * Same function prices CLAI and pi so compare dollars are comparable.
 *
 * DeepSeek V4 Flash: https://api-docs.deepseek.com/quick_start/pricing/
 */

export type TokenUsageForCost = {
  /** Non-cached / cache-miss input tokens */
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
};

export type ProviderRates = {
  inputPerM: number;
  outputPerM: number;
  /** Cache-hit input; defaults to inputPerM when omitted */
  cacheReadPerM?: number;
  /** Cache-write input; defaults to inputPerM when omitted */
  cacheWritePerM?: number;
};

/** Official / documented list prices (USD per 1M tokens). */
export const PROVIDER_RATES: Record<string, ProviderRates> = {
  deepseek: {
    inputPerM: 0.14,
    outputPerM: 0.28,
    cacheReadPerM: 0.0028,
    cacheWritePerM: 0.14,
  },
  groq: { inputPerM: 0.1, outputPerM: 0.5 },
  cerebras: { inputPerM: 0.1, outputPerM: 0.1 },
  openai: { inputPerM: 2.5, outputPerM: 10 },
  anthropic: { inputPerM: 3, outputPerM: 15 },
  gemini: { inputPerM: 0.1, outputPerM: 0.4 },
  openrouter: { inputPerM: 1, outputPerM: 3 },
  gateway: { inputPerM: 0.1, outputPerM: 0.4 },
  default: { inputPerM: 0.1, outputPerM: 0.2 },
};

export function ratesFor(provider: string): ProviderRates {
  return PROVIDER_RATES[provider] ?? PROVIDER_RATES.default!;
}

/**
 * USD from token usage with published cache-hit / cache-write rates when known.
 * Prefer {@link estimateUsdBench} for harness compare — AI SDK often lacks
 * cache splits, so cache-aware pricing is not apples-to-apples across harnesses.
 */
export function estimateUsd(provider: string, usage: TokenUsageForCost): number {
  const rates = ratesFor(provider);
  const input = Math.max(0, Number(usage.input) || 0);
  const output = Math.max(0, Number(usage.output) || 0);
  const cacheRead = Math.max(0, Number(usage.cacheRead) || 0);
  const cacheWrite = Math.max(0, Number(usage.cacheWrite) || 0);
  const readRate = rates.cacheReadPerM ?? rates.inputPerM;
  const writeRate = rates.cacheWritePerM ?? rates.inputPerM;
  const usd =
    (input / 1e6) * rates.inputPerM +
    (cacheRead / 1e6) * readRate +
    (cacheWrite / 1e6) * writeRate +
    (output / 1e6) * rates.outputPerM;
  return Number.isFinite(usd) ? usd : 0;
}

/**
 * Bench/compare dollars: price ALL `tokensIn` at the standard (cache-miss)
 * `inputPerM` rate and `tokensOut` at `outputPerM`. Does **not** apply
 * cache-hit discounts.
 *
 * Why: harness compare needs one tokens→$ mapping. Cache read/write splits are
 * only available on one side (pi); CLAI's AI SDK usage is an undivided prompt
 * total. Applying cache rates on pi alone made more tokens look wildly cheaper.
 */
export function estimateUsdBench(
  provider: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const rates = ratesFor(provider);
  const input = Math.max(0, Number(tokensIn) || 0);
  const output = Math.max(0, Number(tokensOut) || 0);
  const usd =
    (input / 1e6) * rates.inputPerM + (output / 1e6) * rates.outputPerM;
  return Number.isFinite(usd) ? usd : 0;
}

/**
 * Aggregate in/out counters → USD using the same mapping as {@link estimateUsdBench}.
 * Used by the CLAI runner and compare scorecard so both harnesses share one rate.
 */
export function estimateUsdFromTotals(
  provider: string,
  tokensIn: number,
  tokensOut: number,
): number {
  return estimateUsdBench(provider, tokensIn, tokensOut);
}
