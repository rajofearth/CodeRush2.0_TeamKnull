/**
 * Offline LSP + intake demo on fixtures/lsp-ts (no API key).
 * Proves repo_intake + diagnostics after edit + JSONL traces.
 */

import path from "node:path";
import { writeFile } from "node:fs/promises";
import { createSandbox } from "../sandbox/index.js";
import { createTraceWriter } from "../trace/index.js";
import {
  editTool,
  bashTool,
  intakeTool,
  lspDiagnosticsTool,
  lspDefinitionTool,
  lspReferencesTool,
  probeLspAvailability,
  disposeLspSessions,
  type ToolContext,
} from "../tools/index.js";
import type { PlanStep, UiBus } from "../ui/index.js";
import { createToolPlaneBridge } from "../ui/index.js";

export type LspDemoResult = {
  ok: boolean;
  runId: string;
  tracePath: string;
  sandboxMode: string;
  stubReason?: string;
  intakeLanguages: string[];
  issuePrompt: string;
  diagnosticsBefore: number;
  diagnosticsAfter: number;
  checkExitCode: number;
  lsp: Array<{ language: string; engine: string; available: boolean }>;
};

export type RunLspDemoOptions = {
  fixtureDir: string;
  bus: UiBus;
  autoApprove?: boolean;
};

const BUGGY = `/** Shared greeter — intentional type hole for LSP diagnostics demo. */
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

/** Wrong return type on purpose — diagnostics should flag this. */
export function add(a: number, b: number): string {
  return a + b;
}
`;

const FIXED = `/** Shared greeter — intentional type hole for LSP diagnostics demo. */
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

/** Fixed return type for diagnostics demo. */
export function add(a: number, b: number): number {
  return a + b;
}
`;

const PLAN_LABELS = [
  "repo intake map",
  "diagnostics (before)",
  "fix greeter return type",
  "diagnostics (after)",
  "run check.ts",
] as const;

export async function runLspDemo(
  opts: RunLspDemoOptions,
): Promise<LspDemoResult> {
  const fixtureDir = path.resolve(opts.fixtureDir);
  const bus = opts.bus;

  const states: PlanStep["state"][] = [
    "pending",
    "pending",
    "pending",
    "pending",
    "pending",
  ];
  const publishPlan = () =>
    bus.emit({
      type: "plan",
      id: "lsp-demo-plan",
      title: "plan",
      steps: PLAN_LABELS.map((label, i) => ({ label, state: states[i] })),
    });
  const setStep = (index: number, state: PlanStep["state"]) => {
    states[index] = state;
    publishPlan();
  };

  await writeFile(path.join(fixtureDir, "greeter.ts"), BUGGY, "utf8");

  bus.emit({
    type: "user",
    text: "intake map + fix greeter.ts type error using LSP diagnostics",
  });
  publishPlan();
  bus.emit({
    type: "status",
    label: "starting LSP demo",
    detail: "intake + diagnostics, no API key",
  });

  const sandbox = await createSandbox({
    workspaceRoot: fixtureDir,
    autoApprove: opts.autoApprove ?? true,
  });
  const trace = await createTraceWriter({ cwd: fixtureDir });
  const lsp = await probeLspAvailability(fixtureDir);

  bus.emit({
    type: "context",
    title: "LSP + intake demo",
    agent: "demo",
    model: "scripted",
    cwd: fixtureDir,
    runId: trace.runId,
    sandboxMode:
      sandbox.mode === "runtime"
        ? "runtime"
        : `stub${sandbox.stubReason ? ` (${sandbox.stubReason})` : ""}`,
    tracePath: trace.path,
    lsp: lsp.filter((s) => s.available).map((s) => s.engine),
  });

  const ctx: ToolContext = {
    workspaceRoot: fixtureDir,
    sandbox,
    trace,
    onEvent: createToolPlaneBridge(bus),
  };

  let ok = false;
  let intakeLanguages: string[] = [];
  let issuePrompt = "";
  let diagnosticsBefore = 0;
  let diagnosticsAfter = 0;
  let checkExitCode = 1;

  try {
    setStep(0, "active");
    bus.emit({ type: "status", label: "scanning intake map" });
    const intake = await intakeTool(ctx, {});
    const map = (intake.map ?? {}) as {
      languages?: Array<{ id: string }>;
      issuePrompt?: string;
    };
    intakeLanguages = (map.languages ?? []).map((l) => l.id);
    issuePrompt = map.issuePrompt ?? "";
    bus.emit({
      type: "assistant",
      id: "intake-issue",
      text: issuePrompt,
      done: true,
    });
    setStep(0, intake.ok ? "done" : "failed");

    setStep(1, "active");
    bus.emit({ type: "status", label: "LSP diagnostics (before edit)" });
    const before = await lspDiagnosticsTool(ctx, { path: "greeter.ts" });
    diagnosticsBefore = Number(before.count ?? 0);
    await lspDefinitionTool(ctx, { path: "main.ts", line: 1, character: 16 });
    await lspReferencesTool(ctx, { path: "greeter.ts", line: 2, character: 16 });
    setStep(1, before.ok ? "done" : "failed");

    setStep(2, "active");
    bus.emit({ type: "status", label: "editing greeter.ts" });
    const edit = await editTool(ctx, {
      path: "greeter.ts",
      oldString: "export function add(a: number, b: number): string",
      newString: "export function add(a: number, b: number): number",
    });
    setStep(2, edit.ok ? "done" : "failed");

    setStep(3, "active");
    bus.emit({ type: "status", label: "LSP diagnostics (after edit)" });
    disposeLspSessions();
    const after = await lspDiagnosticsTool(ctx, { path: "greeter.ts" });
    diagnosticsAfter = Number(after.count ?? 0);
    setStep(3, after.ok ? "done" : "failed");

    setStep(4, "active");
    bus.emit({
      type: "approval",
      id: "lsp-demo-approval",
      tool: "bash",
      request: "node --import tsx check.ts",
      decision: opts.autoApprove === false ? undefined : "auto",
      reason: "demo auto-approve",
    });
    bus.emit({ type: "status", label: "running verification" });
    const check = await bashTool(ctx, {
      command: "node --import tsx check.ts",
    });
    const checkOk = Boolean(check.ok);
    checkExitCode = Number(check.exitCode ?? 1);
    setStep(4, checkOk ? "done" : "failed");

    ok =
      Boolean(intake.ok) &&
      Boolean(before.ok) &&
      Boolean(edit.ok) &&
      Boolean(after.ok) &&
      diagnosticsBefore > 0 &&
      diagnosticsAfter < diagnosticsBefore &&
      checkOk;

    bus.emit({
      type: "verify",
      id: "lsp-demo-verify",
      label: "diagnostics↓ + check.ts",
      ok,
      detail: `diags ${diagnosticsBefore}→${diagnosticsAfter}; exit ${String(check.exitCode)}`,
      logPath: trace.path,
    });

    await trace.append("info", {
      message: ok ? "lsp demo passed" : "lsp demo failed",
      diagnosticsBefore,
      diagnosticsAfter,
      intakeLanguages,
    });
    await trace.close(ok ? "ok" : "fail");
  } finally {
    await sandbox.dispose();
    disposeLspSessions();
    try {
      await writeFile(path.join(fixtureDir, "greeter.ts"), BUGGY, "utf8");
    } catch {
      /* ignore */
    }
  }

  bus.emit({
    type: "status",
    label: ok ? "lsp demo passed" : "lsp demo failed",
    level: ok ? "info" : "error",
    sticky: true,
    done: true,
  });

  return {
    ok,
    runId: trace.runId,
    tracePath: trace.path,
    sandboxMode: sandbox.mode,
    stubReason: sandbox.stubReason,
    intakeLanguages,
    issuePrompt,
    diagnosticsBefore,
    diagnosticsAfter,
    checkExitCode,
    lsp,
  };
}

/** Exported for tests / reset helpers. */
export const lspFixtureSources = { BUGGY, FIXED };
