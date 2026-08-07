/**
 * Offline / scripted happy-path: edit file + run command on a fixture repo.
 * Proves tools + trace + sandbox + UI event seams without an API key.
 */

import path from "node:path";
import { createSandbox } from "../sandbox/index.js";
import { createTraceWriter } from "../trace/index.js";
import {
  editTool,
  bashTool,
  readTool,
  type ToolContext,
} from "../tools/index.js";
import type { PlanStep, UiBus } from "../ui/index.js";
import { createToolPlaneBridge } from "../ui/index.js";

export type DemoResult = {
  ok: boolean;
  runId: string;
  tracePath: string;
  sandboxMode: string;
  stubReason?: string;
  editedPath: string;
  checkExitCode: number;
};

export type RunOfflineDemoOptions = {
  fixtureDir: string;
  /** Where activity is published (Ink shell and/or headless printer). */
  bus: UiBus;
  autoApprove?: boolean;
};

const PLAN_LABELS = [
  "read hello.txt",
  "apply greeting edit",
  "run check.mjs",
] as const;

export async function runOfflineDemo(
  opts: RunOfflineDemoOptions,
): Promise<DemoResult> {
  const fixtureDir = path.resolve(opts.fixtureDir);
  const bus = opts.bus;

  const states: PlanStep["state"][] = ["pending", "pending", "pending"];
  const publishPlan = () =>
    bus.emit({
      type: "plan",
      id: "demo-plan",
      title: "plan",
      steps: PLAN_LABELS.map((label, i) => ({ label, state: states[i] })),
    });
  const setStep = (index: number, state: PlanStep["state"]) => {
    states[index] = state;
    publishPlan();
  };

  bus.emit({ type: "user", text: "make hello.txt greet CLAI, then verify" });
  publishPlan();
  bus.emit({
    type: "status",
    label: "starting offline demo",
    detail: "edit + bash, no API key",
  });

  const sandbox = await createSandbox({
    workspaceRoot: fixtureDir,
    autoApprove: opts.autoApprove ?? true,
  });

  const trace = await createTraceWriter({ cwd: fixtureDir });
  bus.emit({
    type: "context",
    title: "offline demo",
    agent: "demo",
    model: "scripted",
    cwd: fixtureDir,
    runId: trace.runId,
    sandboxMode:
      sandbox.mode === "runtime"
        ? "runtime"
        : `stub${sandbox.stubReason ? ` (${sandbox.stubReason})` : ""}`,
    tracePath: trace.path,
  });

  const ctx: ToolContext = {
    workspaceRoot: fixtureDir,
    sandbox,
    trace,
    onEvent: createToolPlaneBridge(bus),
  };

  setStep(0, "active");
  bus.emit({ type: "status", label: "reading fixture" });
  await readTool(ctx, { path: "hello.txt" });
  setStep(0, "done");

  setStep(1, "active");
  bus.emit({ type: "status", label: "editing hello.txt" });
  const edit = await editTool(ctx, {
    path: "hello.txt",
    oldString: "Hello, world!",
    newString: "Hello, CLAI!",
  });

  if (!edit.ok) {
    setStep(1, "failed");
    bus.emit({
      type: "status",
      label: "edit failed",
      level: "error",
      sticky: true,
      done: true,
    });
    await trace.close("fail", { reason: "edit failed" });
    await sandbox.dispose();
    return {
      ok: false,
      runId: trace.runId,
      tracePath: trace.path,
      sandboxMode: sandbox.mode,
      stubReason: sandbox.stubReason,
      editedPath: "hello.txt",
      checkExitCode: 1,
    };
  }
  setStep(1, "done");

  setStep(2, "active");
  bus.emit({
    type: "approval",
    id: "demo-approval",
    tool: "bash",
    request: "node check.mjs",
    decision: opts.autoApprove === false ? undefined : "auto",
    reason: "demo auto-approve",
  });
  bus.emit({ type: "status", label: "running verification" });

  const check = await bashTool(ctx, { command: "node check.mjs" });
  const ok = Boolean(check.ok);
  setStep(2, ok ? "done" : "failed");

  bus.emit({
    type: "verify",
    id: "demo-verify",
    label: "check.mjs",
    ok,
    detail: `exit ${String(check.exitCode)}`,
    logPath: trace.path,
  });

  await trace.append("info", {
    message: ok ? "demo passed" : "demo failed",
    sandboxMode: sandbox.mode,
  });
  await trace.close(ok ? "ok" : "fail");
  await sandbox.dispose();

  bus.emit({
    type: "status",
    label: ok ? "demo passed" : "demo failed",
    level: ok ? "info" : "error",
    sticky: true,
    done: true,
  });

  // Leave fixture pristine for git / re-runs (reset also happens at CLI entry).
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      path.join(fixtureDir, "hello.txt"),
      "Hello, world!\n",
      "utf8",
    );
  } catch {
    /* ignore */
  }

  return {
    ok,
    runId: trace.runId,
    tracePath: trace.path,
    sandboxMode: sandbox.mode,
    stubReason: sandbox.stubReason,
    editedPath: "hello.txt",
    checkExitCode: Number(check.exitCode ?? 1),
  };
}
