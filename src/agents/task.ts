/**
 * agents/task — scoped subagents for context isolation (OpenCode-style).
 *
 * Parent delegates via the `task` tool. Child runs in a fresh context with a
 * capped step budget. Only a bounded summary returns to the parent.
 *
 * Agent kinds (inspired by OpenCode explore/general):
 * - explore: read-only (grep/glob/read/lsp/intake) — default
 * - general: read-only + bash (no edit/write/task) for verify-oriented digs
 *
 * Parallel-safe: each invocation builds its own message list and tool map.
 * Emit multiple `task` tool calls in one model step to run subagents in parallel.
 */

import { generateText } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../tools/common.js";
import { emitToolEvent } from "../tools/common.js";
import {
  bashTool,
  createReadOnlyAiTools,
  DEFAULT_BASH_TIMEOUT_MS,
} from "../tools/index.js";
import { MODEL_OUTPUT_CAPS, capToolResultForModel } from "../tools/limits.js";
import { previewForLog } from "../tools/log-preview.js";
import { withProviderRetry } from "../adapter/retry.js";

export type TaskModelHandle = {
  model: unknown;
  provider: string;
  modelId: string;
};

export type TaskAgentKind = "explore" | "general";

const DEFAULT_TASK_MAX_STEPS = 10;

function taskMaxSteps(): number {
  const raw = process.env.CLAI_TASK_MAX_STEPS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TASK_MAX_STEPS;
}

const EXPLORE_SYSTEM = `You are a focused read-only investigator inside CLAI (explore subagent).
Answer the delegated question using grep/glob/read/lsp/repo_intake only.
You cannot edit files or run commands. Hard budget ~10 tool calls — be surgical.
Finish with a concise plain-text summary (under 1500 characters): key findings, file paths with line numbers, open questions. That summary is ALL the caller will see.`;

const GENERAL_SYSTEM = `You are a focused investigator inside CLAI (general subagent).
Answer the delegated question using read tools and bash for verification (tests, git status, typecheck).
You cannot edit/write files or spawn further subagents. Hard budget ~10 tool calls — be surgical.
Finish with a concise plain-text summary (under 1500 characters): key findings, commands you ran, file paths with line numbers. That summary is ALL the caller will see.`;

export type TaskRunResult = {
  ok: boolean;
  tool: "task";
  agent: TaskAgentKind;
  summary: string;
  steps: number;
  truncated: boolean;
  error?: string;
  durationMs: number;
};

function childTools(ctx: ToolContext, agent: TaskAgentKind) {
  const readOnly = createReadOnlyAiTools(ctx);
  if (agent === "explore") return readOnly;
  return {
    ...readOnly,
    bash: tool({
      description:
        "Run a short verification command (tests, git, typecheck). ~60s timeout.",
      parameters: z.object({
        command: z.string().describe("Shell command to run"),
      }),
      execute: async (args) => {
        const full = await bashTool(ctx, {
          command: args.command,
          timeoutMs: DEFAULT_BASH_TIMEOUT_MS,
        });
        return capToolResultForModel("bash", full).result;
      },
    }),
  };
}

/** Run one delegated investigation in a fresh context. Exported for tests. */
export async function runTaskSubagent(
  ctx: ToolContext,
  model: TaskModelHandle,
  args: { prompt: string; paths?: string; agent?: TaskAgentKind },
): Promise<TaskRunResult> {
  const started = Date.now();
  const agent: TaskAgentKind = args.agent === "general" ? "general" : "explore";
  const childCtx: ToolContext = {
    ...ctx,
    // Subagents do not inherit bg shell control — keep jobs on the parent.
    shellJobs: undefined,
    onEvent: (event) => {
      if (event.type === "tool_call" || event.type === "tool_result") {
        ctx.onEvent?.({ ...event, group: "subagent" });
        return;
      }
      ctx.onEvent?.(event);
    },
  };
  const tools = childTools(childCtx, agent);

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
          system: agent === "general" ? GENERAL_SYSTEM : EXPLORE_SYSTEM,
          messages: [{ role: "user", content: promptText }],
        }),
      {
        onTrace: async (payload) => {
          await ctx.trace?.append("info", {
            scope: "task_subagent",
            agent,
            ...payload,
          });
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
      agent,
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
      agent,
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
 * toolset, so delegation cannot recurse. Multiple `task` calls in one step
 * run in parallel (Vercel AI SDK).
 */
export function createTaskTool(ctx: ToolContext, model: TaskModelHandle) {
  return tool({
    description:
      "Delegate an investigation to a subagent with its own fresh context (~10 tool-call budget). " +
      "agent=explore (default): read-only. agent=general: read-only + bash for verification. " +
      "Emit multiple task calls in one step to run subagents in parallel. " +
      "Use for broad exploration so findings return as a short summary instead of filling your context.",
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
      agent: z
        .enum(["explore", "general"])
        .nullable()
        .describe("Subagent kind: explore (read-only) or general (+bash); null=explore"),
    }),
    execute: async (args) => {
      const agent: TaskAgentKind =
        args.agent === "general" ? "general" : "explore";
      await emitToolEvent(ctx, "tool_call", "task", {
        target: args.prompt.slice(0, 120),
        group: "subagent",
        detail: agent,
        input: {
          prompt: args.prompt,
          paths: args.paths ?? undefined,
          agent,
        },
      });
      const full = await runTaskSubagent(ctx, model, {
        prompt: args.prompt,
        paths: args.paths ?? undefined,
        agent,
      });
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
          ? `${agent} · ${full.steps} steps · ${Buffer.byteLength(full.summary, "utf8")}B`
          : full.error ?? "subagent failed",
        output: previewForLog("task", full),
      });
      return result;
    },
  });
}
