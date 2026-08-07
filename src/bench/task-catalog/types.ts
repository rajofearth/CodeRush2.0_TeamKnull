/**
 * Catalog types for bench fixture scaffolding.
 * Tasks are adapted from Terminal-Bench 2.1 and DeepSWE themes into
 * self-contained Node.js ESM fixtures for the CLAI harness.
 */

import type { BenchCategory } from "../types.js";

export type TaskSource = {
  benchmark: "terminal-bench" | "deepswe" | "clai";
  /** Original task id when adapted from an external benchmark. */
  taskId: string;
};

export type CatalogTask = {
  id: string;
  title: string;
  prompt: string;
  category: BenchCategory;
  source: TaskSource;
  timeoutMs?: number;
  maxSteps?: number;
  /** Relative paths under the fixture dir (excluding task.json, check.mjs). */
  files: Record<string, string>;
  solution: Record<string, string>;
  /** Full check.mjs source. Must exit 0 on solution, non-zero on broken. */
  check: string;
};

/** Original 8 tasks — scaffold must not overwrite these. */
export const LEGACY_TASK_IDS = new Set([
  "fix-async-race",
  "fix-broken-import",
  "fix-json-config",
  "fix-test-assertion",
  "implement-slugify",
  "off-by-one",
  "refactor-report",
  "validate-quantity",
]);
