/**
 * Per-harness compare resume: keep pass/fail rows, re-run error/missing sides.
 */
import type { CompareResult, CompareRow } from "./compare-pi.js";

export function isKeepableRow(
  row?: Pick<CompareRow, "status"> | null,
): boolean {
  return row?.status === "pass" || row?.status === "fail";
}

export type ResumeSeed = {
  clai: Array<CompareRow | undefined>;
  pi: Array<CompareRow | undefined>;
  codex: Array<CompareRow | undefined>;
  compareId?: string;
  claiRunId?: string;
  claiLabel?: string;
  /** Task ids that still need a CLAI run. */
  claiTodo: string[];
  /** Task indices that still need pi / codex. */
  piTodo: number[];
  codexTodo: number[];
};

export type ResumeModelExpect = {
  piProvider: string;
  piModel: string;
  codexProfile?: string;
  codexModel?: string;
  /** When true, require prior.mode === "all" (or prior.codex present). */
  requireAll?: boolean;
};

/**
 * Refuse resume when the prior scorecard was for different models / mode.
 * Task-id coverage is soft: missing ids are treated as fresh work.
 */
export function assertResumeCompatible(
  prior: CompareResult,
  expect: ResumeModelExpect,
): void {
  if (prior.partial === true) {
    throw new Error("Cannot resume a still-partial compare scorecard.");
  }
  if (
    prior.piProvider !== expect.piProvider ||
    prior.piModel !== expect.piModel
  ) {
    throw new Error(
      `Resume model mismatch: prior pi ${prior.piProvider}/${prior.piModel} vs ` +
        `${expect.piProvider}/${expect.piModel}`,
    );
  }
  if (expect.requireAll) {
    const priorAll = prior.mode === "all" || (prior.codex && prior.codex.length);
    if (!priorAll) {
      throw new Error(
        "Resume requires a three-way (CLAI+pi+codex) compare scorecard.",
      );
    }
    if (
      expect.codexProfile != null &&
      prior.codexProfile != null &&
      prior.codexProfile !== expect.codexProfile
    ) {
      throw new Error(
        `Resume codex profile mismatch: prior ${prior.codexProfile} vs ${expect.codexProfile}`,
      );
    }
    if (
      expect.codexModel != null &&
      prior.codexModel != null &&
      prior.codexModel !== expect.codexModel
    ) {
      throw new Error(
        `Resume codex model mismatch: prior ${prior.codexModel} vs ${expect.codexModel}`,
      );
    }
  }
}

/** Align prior rows to the current task list; keep only pass/fail. */
export function seedResumeFromPrior(
  taskIds: string[],
  prior: CompareResult,
): ResumeSeed {
  const claiById = new Map(
    (prior.clai || []).filter(Boolean).map((r) => [r.id, r]),
  );
  const piById = new Map(
    (prior.pi || []).filter(Boolean).map((r) => [r.id, r]),
  );
  const codexById = new Map(
    (prior.codex || []).filter(Boolean).map((r) => [r.id, r]),
  );

  const clai: Array<CompareRow | undefined> = new Array(taskIds.length);
  const pi: Array<CompareRow | undefined> = new Array(taskIds.length);
  const codex: Array<CompareRow | undefined> = new Array(taskIds.length);
  const claiTodo: string[] = [];
  const piTodo: number[] = [];
  const codexTodo: number[] = [];

  for (let i = 0; i < taskIds.length; i++) {
    const id = taskIds[i]!;
    const c = claiById.get(id);
    const p = piById.get(id);
    const x = codexById.get(id);
    if (isKeepableRow(c)) clai[i] = c;
    else claiTodo.push(id);
    if (isKeepableRow(p)) pi[i] = p;
    else piTodo.push(i);
    if (isKeepableRow(x)) codex[i] = x;
    else codexTodo.push(i);
  }

  return {
    clai,
    pi,
    codex,
    compareId: prior.compareId,
    claiRunId: prior.claiRunId,
    claiLabel: prior.claiLabel,
    claiTodo,
    piTodo,
    codexTodo,
  };
}

/** True when a finished compare still has error/aborted sides worth retrying. */
export function compareHasResumableErrors(prior: CompareResult | null | undefined): boolean {
  if (!prior || prior.partial === true) return false;
  if (prior.stopped) return true;
  const rows = [
    ...(prior.clai || []),
    ...(prior.pi || []),
    ...(prior.codex || []),
  ];
  return rows.some((r) => r && r.status === "error");
}
