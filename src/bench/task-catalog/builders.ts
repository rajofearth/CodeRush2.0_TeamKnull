/**
 * Compact builders for bench catalog tasks.
 */

import type { CatalogTask, TaskSource } from "./types.js";

const DEFAULT_TIMEOUT = 150_000;
const DEFAULT_STEPS = 12;

export function checkFromTests(taskId: string, testBody: string): string {
  const lines = testBody.trim().split("\n");
  const importLines: string[] = [];
  const bodyLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("import ")) {
      importLines.push(trimmed);
    } else {
      bodyLines.push(line);
    }
  }
  const hasAssert = importLines.some((l) => /import\s+assert\b/.test(l));
  if (!hasAssert) {
    importLines.unshift('import assert from "node:assert/strict";');
  }
  return `${importLines.join("\n")}

(async () => {
  try {
${bodyLines
  .map((line) => (line.trim() ? `    ${line.trimStart()}` : ""))
  .join("\n")}
    console.log("PASS ${taskId}");
  } catch (err) {
    console.error("FAIL ${taskId}:", err.message);
    process.exit(1);
  }
})();
`;
}

export function checkFromTestFile(taskId: string, testFile: string): string {
  return `import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  execFileSync(process.execPath, [${JSON.stringify(testFile)}], { cwd: here, stdio: "pipe" });
  console.log("PASS ${taskId}");
} catch (err) {
  console.error("FAIL ${taskId}:", err.stderr?.toString() || err.message);
  process.exit(1);
}
`;
}

type BaseMeta = {
  id: string;
  title: string;
  prompt: string;
  source: TaskSource;
  category?: CatalogTask["category"];
  timeoutMs?: number;
  maxSteps?: number;
};

export function singleModuleTask(
  meta: BaseMeta & {
    module: string;
    broken: string;
    fixed: string;
    testBody: string;
  },
): CatalogTask {
  return {
    category: meta.category ?? "bugfix",
    timeoutMs: meta.timeoutMs ?? DEFAULT_TIMEOUT,
    maxSteps: meta.maxSteps ?? DEFAULT_STEPS,
    files: { [meta.module]: meta.broken },
    solution: { [meta.module]: meta.fixed },
    check: checkFromTests(meta.id, meta.testBody),
    ...meta,
  };
}

export function multiFileTask(
  meta: BaseMeta & {
    files: Record<string, string>;
    solution: Record<string, string>;
    testBody: string;
  },
): CatalogTask {
  return {
    category: meta.category ?? "feature",
    timeoutMs: meta.timeoutMs ?? DEFAULT_TIMEOUT,
    maxSteps: meta.maxSteps ?? DEFAULT_STEPS,
    check: checkFromTests(meta.id, meta.testBody),
    ...meta,
  };
}

export function specAndTestTask(
  meta: BaseMeta & {
    module: string;
    stub: string;
    fixed: string;
    spec: string;
    testFile: string;
    testContent: string;
  },
): CatalogTask {
  const verify = "Verify with `node check.mjs` (exit code 0 means done).";
  const prompt = meta.prompt.includes("check.mjs")
    ? meta.prompt
    : `${meta.prompt} ${verify}`;
  return {
    category: meta.category ?? "feature",
    timeoutMs: meta.timeoutMs ?? DEFAULT_TIMEOUT,
    maxSteps: meta.maxSteps ?? DEFAULT_STEPS,
    prompt,
    files: {
      [meta.module]: meta.stub,
      "SPEC.md": meta.spec,
      [meta.testFile]: meta.testContent,
    },
    solution: { [meta.module]: meta.fixed },
    check: checkFromTestFile(meta.id, meta.testFile),
    id: meta.id,
    title: meta.title,
    source: meta.source,
  };
}
