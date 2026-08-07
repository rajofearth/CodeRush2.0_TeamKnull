/**
 * agents/task — scoped read-only subagent for context isolation.
 *
 * The parent model delegates an investigation (`prompt`, optional `paths`
 * hint) to a sub-loop with its OWN fresh context, a capped step budget, and
 * read-only tools (read/grep/glob/lsp/intake — no edit/write/bash). Only a
 * bounded summary returns to the parent context, so exploration burns the
 * subagent's context, not the parent's.
 *
 * Parallel-safe: each invocation builds its own message list and tool map;
 * nothing is shared beyond the (single-threaded) sandbox/trace handles.
 */

import { generateText } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../tools/common.js";
import { createReadOnlyAiTools } from "../tools/index.js";
import { MODEL_OUTPUT_CAPS, capToolResultForModel } from "../tools/limits.js";
import { emitToolEvent } from "../tools/common.js";
import { withProviderRetry } from "../adapter/retry.js";

export type TaskModelHandle = {
  model: unknown;
  provider: string;
  modelId: string;
};

const DEFAULT_TASK_MAX_STEPS = 10;

function taskMaxSteps(): number {
  const raw = process.env.CLAI_TASK_MAX_STEPS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TASK_MAX_STEPS;
}

const TASK_SYSTEM = `You are a focused read-only investigator inside CLAI.
Answer the delegated question about this workspace using the available tools (grep/glob/read/lsp/repo_intake).
You cannot edit files or run commands. You have a hard budget of ~10 tool calls — be surgical, not exhaustive.
Finish with a concise plain-text summary (under 1500 characters): key findings, relevant file paths with line numbers, and any open questions. That summary is ALL the caller will see.`;

export type TaskRunResult = {
  ok: boolean;
  tool: "task";
  summary: string;
  steps: number;
  truncated: boolean;
  error?: string;
  durationMs: number;
};

/** Run one delegated investigation in a fresh context. Exported for tests. */
export async function runTaskSubagent(
  ctx: ToolContext,
  model: TaskModelHandle,
  args: { prompt: string; paths?: string },
): Promise<TaskRunResult> {
  const started = Date.now();
  // Child context: same workspace/sandbox/trace, but tool events are tagged
  // so the UI can render them as a subagent row.
  const childCtx: ToolContext = {
    ...ctx,
    onEvent: (event) => {
      // Keep real tool names (read/grep/…) so the UI stays readable; tag the
      // group so rows cluster under a "subagent" header instead of "task:read".
      if (event.type === "tool_call" || event.type === "tool_result") {
        ctx.onEvent?.({ ...event, group: "subagent" });
        return;
      }
      ctx.onEvent?.(event);
    },
  };
  const tools = createReadOnlyAiTools(childCtx);

  const promptText = args.paths
    ? `${args.prompt}\n\nStart with these paths: ${args.paths}`
    : args.prompt;

  try {
    const result = await withProviderRetry(
      () =>
        generateText({
          model: model.model as Parameters<typeof generateText>[0]["model"],
          tools,
          maxSteps: taskMaxSteps(),
          maxRetries: 0,
          system: TASK_SYSTEM,
          messages: [{ role: "user", content: promptText }],
        }),
      {
        onTrace: async (payload) => {
          await ctx.trace?.append("info", { scope: "task_subagent", ...payload });
        },
      },
    );
    const raw = result.text.trim() || "(subagent returned no summary)";
    const truncated =
      Buffer.byteLength(raw, "utf8") > MODEL_OUTPUT_CAPS.taskSummaryMaxBytes;
    const summary = truncated
      ? `${raw.slice(0, MODEL_OUTPUT_CAPS.taskSummaryMaxBytes)}\n… [summary truncated]`
      : raw;
    return {
      ok: true,
      tool: "task",
      summary,
      steps: result.steps?.length ?? 1,
      truncated,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      tool: "task",
      summary: "",
      steps: 0,
      truncated: false,
      error: message.slice(0, 400),
      durationMs: Date.now() - started,
    };
  }
}

/**
 * AI SDK `task` tool for the parent loop. Not included in the subagent's own
 * toolset, so delegation cannot recurse.
 */
export function createTaskTool(ctx: ToolContext, model: TaskModelHandle) {
  return tool({
    description:
      "Delegate a scoped READ-ONLY investigation to a subagent with its own fresh context and ~10 tool-call budget. Use for broad exploration ('how does X work', 'where is Y handled') so the findings come back as a short summary instead of filling your context with raw file contents. Not for edits or running commands.",
    parameters: z.object({
      prompt: z
        .string()
        .describe("The specific question the subagent should answer"),
      paths: z
        .string()
        .nullable()
        .describe(
          "Comma-separated file/dir hints to start from, or null if unknown",
        ),
    }),
    execute: async (args) => {
      await emitToolEvent(ctx, "tool_call", "task", {
        target: args.prompt.slice(0, 120),
        group: "subagent",
        input: { prompt: args.prompt, paths: args.paths ?? undefined },
      });
      const full = await runTaskSubagent(ctx, model, {
        prompt: args.prompt,
        paths: args.paths ?? undefined,
      });
      // Parent context only ever sees the bounded summary; keep the full
      // result in the trace when we had to clip.
      if (full.truncated || !full.ok) {
        await ctx.trace?.append("tool_result", {
          tool: "task",
          fullOutput: true,
          output: full,
        });
      }
      const { result } = capToolResultForModel("task", full);
      await emitToolEvent(ctx, "tool_result", "task", {
        target: args.prompt.slice(0, 120),
        group: "subagent",
        ok: full.ok,
        durationMs: full.durationMs,
        detail: full.ok
          ? `${full.steps} steps · ${Buffer.byteLength(full.summary, "utf8")}B`
          : full.error ?? "subagent failed",
        output: { steps: full.steps, truncated: full.truncated },
      });
      return result;
    },
  });
}
