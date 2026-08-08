/**
 * Offline check: resume seeding keeps CLAI pass/fail and only queues pi/codex errors.
 * Run: pnpm exec tsx src/bench/__checks__/compare-resume-check.ts
 */
import {
  assertResumeCompatible,
  compareHasResumableErrors,
  isKeepableRow,
  seedResumeFromPrior,
} from "../compare-resume.js";
import type { CompareResult, CompareRow } from "../compare-pi.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function row(
  id: string,
  harness: CompareRow["harness"],
  status: CompareRow["status"],
  detail?: string,
): CompareRow {
  return {
    id,
    harness,
    status,
    wallMs: status === "error" ? 0 : 100,
    detail,
    tokensIn: 10,
    tokensOut: 2,
    cost: 0.001,
  };
}

const prior: CompareResult = {
  at: "2026-08-08T00:00:00.000Z",
  mode: "all",
  compareId: "compare-all-test",
  piProvider: "deepseek",
  piModel: "deepseek-v4-flash",
  codexProfile: "deepseek",
  codexModel: "deepseek-v4-flash",
  claiLabel: "run-xyz [deepseek/deepseek-v4-flash] fresh",
  claiRunId: "run-xyz",
  stopped: true,
  clai: [
    row("keep-pass", "clai", "pass"),
    row("keep-fail", "clai", "fail", "check failed"),
    row("retry-clai", "clai", "error", "terminated"),
  ],
  pi: [
    row("keep-pass", "pi", "pass"),
    row(
      "keep-fail",
      "pi",
      "error",
      "stall · 0 bytes after 15000ms (no pi JSON — hung / no output)",
    ),
    row(
      "retry-clai",
      "pi",
      "error",
      "circuit breaker — 3 consecutive pi stalls/timeouts",
    ),
  ],
  codex: [
    row("keep-pass", "codex", "pass"),
    row("keep-fail", "codex", "pass"),
    row("retry-clai", "codex", "error", "aborted"),
  ],
  claiScore: { pass: 1, fail: 1, err: 1, total: 3, rate: 1 / 3 },
  piScore: { pass: 1, fail: 0, err: 2, total: 3, rate: 1 / 3 },
  codexScore: { pass: 2, fail: 0, err: 1, total: 3, rate: 2 / 3 },
};

assert(isKeepableRow(row("a", "clai", "pass")), "pass keepable");
assert(isKeepableRow(row("a", "clai", "fail")), "fail keepable");
assert(!isKeepableRow(row("a", "clai", "error")), "error not keepable");
assert(compareHasResumableErrors(prior), "stopped compare is resumable");

assertResumeCompatible(prior, {
  piProvider: "deepseek",
  piModel: "deepseek-v4-flash",
  codexProfile: "deepseek",
  codexModel: "deepseek-v4-flash",
  requireAll: true,
});

let threw = false;
try {
  assertResumeCompatible(prior, {
    piProvider: "deepseek",
    piModel: "other-model",
    requireAll: true,
  });
} catch {
  threw = true;
}
assert(threw, "model mismatch must refuse");

const seed = seedResumeFromPrior(
  ["keep-pass", "keep-fail", "retry-clai"],
  prior,
);

assert(seed.compareId === "compare-all-test", "keep compareId");
assert(seed.claiTodo.length === 1 && seed.claiTodo[0] === "retry-clai", "clai todo");
assert(
  seed.piTodo.length === 2 &&
    seed.piTodo.includes(1) &&
    seed.piTodo.includes(2),
  `pi todo expected [1,2], got ${JSON.stringify(seed.piTodo)}`,
);
assert(
  seed.codexTodo.length === 1 && seed.codexTodo[0] === 2,
  `codex todo expected [2], got ${JSON.stringify(seed.codexTodo)}`,
);
assert(isKeepableRow(seed.clai[0]), "kept clai pass");
assert(isKeepableRow(seed.clai[1]), "kept clai fail");
assert(!seed.clai[2], "retry clai not seeded");
assert(isKeepableRow(seed.pi[0]), "kept pi pass");
assert(!seed.pi[1], "pi stall not kept");
assert(isKeepableRow(seed.codex[0]) && isKeepableRow(seed.codex[1]), "kept codex");

console.log(
  "compare-resume-check ok · claiTodo=" +
    seed.claiTodo.join(",") +
    " · piTodo=" +
    seed.piTodo.join(",") +
    " · codexTodo=" +
    seed.codexTodo.join(","),
);
