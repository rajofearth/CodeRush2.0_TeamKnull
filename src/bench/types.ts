/**
 * bench/types — shared shapes for the CLAI benchmark system.
 */

export type BenchCategory = "bugfix" | "feature" | "refactor" | "test";

export type BenchTaskSpec = {
  id: string;
  title: string;
  /** Prompt handed to the agent loop verbatim. */
  prompt: string;
  category: BenchCategory;
  /** Hard wall-clock limit for the agent phase, per task. */
  timeoutMs: number;
  /** maxSteps forwarded to the agent loop. */
  maxSteps: number;
  /** Absolute path of the fixture directory. */
  dir: string;
};

export type TaskStatus =
  | "queued"
  | "running"
  | "pass"
  | "fail"
  | "timeout"
  | "error";

export type TaskResult = {
  id: string;
  title: string;
  category: BenchCategory;
  status: TaskStatus;
  /** Wall time of the whole task (agent + check), ms. */
  wallMs: number;
  /** Agent loop steps taken (0 in offline mode unless patched). */
  steps: number;
  /** Tool call counts keyed by tool name (e.g. { read: 2, edit: 1 }). */
  toolCalls: Record<string, number>;
  tokensIn: number;
  tokensOut: number;
  /** Estimated USD cost (see PRICING in runner.ts — rough, per-1M-token). */
  cost: number;
  /** check.mjs exit code, when it ran. */
  checkExitCode?: number;
  /** Trailing check output for display. */
  checkOutput?: string;
  /** Crash / timeout description when status is error or timeout. */
  error?: string;
  /** events.jsonl path for this task's agent run. */
  tracePath?: string;
};

export type BenchAggregates = {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  timedOut: number;
  passRate: number;
  totalWallMs: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
};

export type BenchRunRecord = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  provider: string;
  model: string;
  offline: boolean;
  parallel: number;
  taskIds: string[];
  tasks: TaskResult[];
  aggregates: BenchAggregates;
};

/** Live view of an in-flight (or just-finished) run, pushed to the dashboard. */
export type LiveTask = {
  id: string;
  title: string;
  category: BenchCategory;
  status: TaskStatus;
  wallMs?: number;
  steps?: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  error?: string;
};

export type LiveSnapshot = {
  runId: string;
  startedAt: string;
  provider: string;
  model: string;
  offline: boolean;
  parallel: number;
  tasks: LiveTask[];
  done: boolean;
};

export function computeAggregates(tasks: TaskResult[]): BenchAggregates {
  const passed = tasks.filter((t) => t.status === "pass").length;
  const failed = tasks.filter((t) => t.status === "fail").length;
  const errored = tasks.filter((t) => t.status === "error").length;
  const timedOut = tasks.filter((t) => t.status === "timeout").length;
  return {
    total: tasks.length,
    passed,
    failed,
    errored,
    timedOut,
    passRate: tasks.length ? passed / tasks.length : 0,
    totalWallMs: tasks.reduce((a, t) => a + t.wallMs, 0),
    totalTokensIn: tasks.reduce((a, t) => a + t.tokensIn, 0),
    totalTokensOut: tasks.reduce((a, t) => a + t.tokensOut, 0),
    totalCost: tasks.reduce((a, t) => a + t.cost, 0),
  };
}
