/**
 * adapter — Vercel AI SDK soft agent loop + pluggable providers.
 * Default: Groq (OpenAI-compatible) via GROQ_API_KEY.
 */

import {
  streamText,
  InvalidToolArgumentsError,
  NoSuchToolError,
  type CoreMessage,
} from "ai";
import type { ToolContext } from "../tools/index.js";
import { createAiTools } from "../tools/index.js";
import type { TraceWriter } from "../trace/index.js";
import { createTaskTool } from "../agents/index.js";
import {
  compactHistory,
  compactionConfigFromEnv,
  formatTokens,
} from "../context/compact.js";
import { withProviderRetry, ProviderError, type RetryStatusEvent } from "./retry.js";
import {
  createProviderHandle,
  hasAnyProviderKey,
  type ProviderHandle,
  type ProviderId,
} from "./providers.js";

export type { ProviderId, ProviderHandle } from "./providers.js";
export { listProviders, DEFAULT_PROVIDER } from "./providers.js";
export {
  withProviderRetry,
  classifyProviderError,
  ProviderError,
  type RetryStatusEvent,
  type RetryOptions,
} from "./retry.js";

export type ResolvedModel = {
  model: ProviderHandle["model"];
  provider: ProviderId;
  modelId: string;
};

export type ResolveModelOptions = {
  modelId?: string;
  prefer?: ProviderId;
};

export function hasApiKey(): boolean {
  return hasAnyProviderKey();
}

export async function resolveModel(
  opts: ResolveModelOptions = {},
): Promise<ResolvedModel> {
  const handle = await createProviderHandle(opts.prefer, opts.modelId);
  return {
    model: handle.model,
    provider: handle.id,
    modelId: handle.modelId,
  };
}

export type AgentLoopOptions = {
  ctx: ToolContext;
  prompt: string;
  /** Prior turns for multi-turn chat (excluding the new user prompt). */
  history?: CoreMessage[];
  /**
   * Extra system context (e.g. intake notes). Appended AFTER the built-in
   * behavior policy — it never replaces it.
   */
  system?: string;
  maxSteps?: number;
  model?: ResolvedModel;
  trace?: TraceWriter;
  /**
   * Optional harness memory store. When set with `trace`, runs ContextManager
   * assemble() for glass-box `context_stage` events. Does not change the
   * prompt unless `injectAssembledContext` is true.
   */
  memoryStore?: import("../memory/index.js").MemoryStore;
  /** Role label for glass correlation (main / chat / explore / …). */
  agentRole?: string;
  /** Token budget for the observability assemble() call. */
  assembleTokenBudget?: number;
  /**
   * When true, merge assemble() systemExtras into the system prompt.
   * Default false — preserves existing loop behaviour; stages still emit.
   */
  injectAssembledContext?: boolean;
  onText?: (text: string) => void;
  /**
   * Incremental assistant prose (token/chunk deltas). Prefer this for live TUI
   * streaming; `onText` still fires with the full step text when a step ends.
   */
  onTextDelta?: (delta: string) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
  }) => void;
  /** Harness status updates (compaction, rate-limit retries). */
  onStatus?: (status: RetryStatusEvent) => void;
};

export type AgentLoopResult = {
  text: string;
  finishReason: string;
  steps: number;
  provider?: string;
  modelId?: string;
  /** Full message list after this turn (for the next prompt). */
  messages: CoreMessage[];
};

const DEFAULT_SYSTEM = `You are CLAI, a coding agent in an interactive ADE session. Use tools to explore and edit the workspace.

## Proportional effort — match your response to the request
Classify each request before touching tools:
1. CONVERSATIONAL / INFORMATIONAL ("what is this project about?", "which package manager?", "what does src/x.ts do?"):
   Answer directly in prose. Use AT MOST 1-2 quick reads of obvious sources (package.json, README.md / AGENTS.md, the intake notes already in context, or the one file asked about). Do NOT run bash, do NOT run repo_intake if intake notes are already provided, do NOT explore fixtures or spawn search batches.
   Important: a "Bounded intake issue …" seed is a demo task hint, NOT the project description. If intake notes begin with "Project: …", that IS the product summary — answer from it with ZERO tool calls. Otherwise read package.json (preferred) or AGENTS.md / README.md.
2. CHANGE / VERIFY tasks ("fix the bug in…", "add a flag…", "why does the test fail?"):
   Explore as needed (grep/glob/read/LSP), edit, then verify with lsp_diagnostics and/or a bash command.
Examples:
- "what's this project about?" → answer from intake "Project: …" line, or one read of package.json. No bash. No fixture spelunking. No test runs.
- "list the entrypoints" → answer from intake notes; maybe one read of package.json.
- "rename function foo to bar" → grep for usages, edit, lsp_diagnostics, done.
Running tests or bash is for verifying changes or diagnosing failures — never for answering descriptive questions.

## Style
Answer in prose FIRST for simple questions — never narrate a tool plan for a trivial query.
Be concise. Soft completion: stop when the task looks done — there is no hard finish gate.

## Tool use
Prefer read-only discovery (grep/glob/read/repo_intake/LSP) before edits.
Emit multiple tool calls in ONE step to run them in parallel (reads, greps, or several task subagents).
Use parallel({jobs:[…]}) to batch up to 6 read-only tools when you want one combined result.
Use the task tool to delegate investigations — agent=explore (read-only) or agent=general (+bash). Multiple task calls in one step run in parallel.
For long-running commands (dev servers, watchers, big builds) use bash_bg, then bash_output / bash_jobs / bash_kill — do not block on foreground bash.
Use lsp_diagnostics after edits on TS/Python; lsp_definition / lsp_references for navigation.
Large tool outputs are truncated with a marker — re-run scoped narrower (read with offset/limit, grep with a tighter pattern/path) if you need the omitted part.
Tool tips: glob pattern use **/* ; read needs path (offset/limit optional); edit needs path+oldString+newString; bash needs command; bash_bg for background.`;

/** Compose the built-in policy with caller-provided extra context. */
function composeSystem(extra?: string): string {
  if (!extra) return DEFAULT_SYSTEM;
  return `${DEFAULT_SYSTEM}

## Session context
${extra}

## Reminder
Session context above is evidence (intake notes, etc.). For conversational / informational questions, answer from it directly — do not treat a generic "explore" nudge as permission to spelunk fixtures or run bash.`;
}

function isToolValidationError(err: unknown): boolean {
  if (InvalidToolArgumentsError.isInstance(err)) return true;
  if (NoSuchToolError.isInstance(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /tool call validation failed|did not match schema|additionalProperties/i.test(
    msg,
  );
}

/** Strip unknown keys / fill nullables so Groq-ish bad args can still run. */
function repairToolArgs(
  toolName: string,
  rawArgs: string,
  schema: { properties?: Record<string, unknown>; required?: string[] },
): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Common alias mistakes from smaller models
  if (toolName === "read") {
    if (parsed.line != null && parsed.offset == null) {
      parsed.offset = parsed.line;
    }
    if (parsed.file != null && parsed.path == null) {
      parsed.path = parsed.file;
    }
  }
  if (toolName === "bash" && parsed.cmd != null && parsed.command == null) {
    parsed.command = parsed.cmd;
  }
  if (
    (toolName === "glob" || toolName === "grep") &&
    parsed.glob != null &&
    parsed.pattern == null
  ) {
    parsed.pattern = parsed.glob;
  }

  const allowed = new Set(Object.keys(schema.properties ?? {}));
  const cleaned: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in parsed) cleaned[key] = parsed[key];
  }
  for (const key of schema.required ?? []) {
    if (!(key in cleaned)) {
      // nullable fields → null; strings → sensible defaults
      if (key === "pattern" && (toolName === "glob" || toolName === "grep")) {
        cleaned[key] = toolName === "glob" ? "**/*" : "";
      } else if (key === "path" && toolName !== "read" && toolName !== "edit" && toolName !== "write") {
        cleaned[key] = null;
      } else if (!(key in cleaned)) {
        // cannot invent required path/command/etc.
        if (!("path" in cleaned) && toolName === "read") return null;
        if (!("command" in cleaned) && toolName === "bash") return null;
      }
    }
  }

  // Drop empties that would still fail
  if (toolName === "read" && (cleaned.path == null || cleaned.path === "")) {
    return null;
  }

  return JSON.stringify(cleaned);
}

export async function runAgentLoop(
  opts: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const resolved = opts.model ?? (await resolveModel());
  const tools = {
    ...createAiTools(opts.ctx),
    task: createTaskTool(opts.ctx, resolved),
  };
  const maxSteps = opts.maxSteps ?? 12;

  await opts.trace?.append("model_step", {
    provider: resolved.provider,
    modelId: resolved.modelId,
    maxSteps,
    prompt: opts.prompt.slice(0, 500),
  });

  let messages: CoreMessage[] = [
    ...(opts.history ?? []),
    { role: "user", content: opts.prompt },
  ];

  // Context compaction: when assembled history approaches the budget, replace
  // older turns with a deterministic structured digest (system prompt, the
  // original task, and the last N messages are kept verbatim).
  const compactCfg = compactionConfigFromEnv();
  {
    const compaction = compactHistory(messages, compactCfg);
    if (compaction.compacted) {
      messages = compaction.messages;
      const label = `compacted context: ${formatTokens(compaction.beforeTokens)} → ${formatTokens(compaction.afterTokens)} tokens`;
      opts.onStatus?.({ label, sticky: true });
      await opts.trace?.append("info", {
        message: "context_compacted",
        beforeTokens: compaction.beforeTokens,
        afterTokens: compaction.afterTokens,
        droppedMessages: compaction.droppedMessages,
      });
    }
  }

  const totals = { promptTokens: 0, completionTokens: 0 };
  let systemExtra = opts.system;

  // Glass-box: stage 0 (prompt_synthesis) then assemble() stages into the same
  // trace. Prompt injection is opt-in so loop behaviour stays unchanged by default.
  if (opts.trace && opts.memoryStore) {
    try {
      const {
        ContextManager,
        createTraceStageEmitter,
        synthesizeContextRequest,
      } = await import("../context/index.js");
      const emitStage = createTraceStageEmitter(opts.trace);
      const req = synthesizeContextRequest(opts.prompt, {
        runId: opts.trace.runId,
        tokenBudget: opts.assembleTokenBudget ?? 8000,
        memoryEnabled: process.env.CLAI_MEMORY_ENABLED !== "0",
        structuralCitationsEnabled:
          process.env.CLAI_STRUCTURAL_CITATIONS !== "0",
        agentRole: opts.agentRole ?? "main",
        emitStage,
      });
      const assembled = new ContextManager(
        opts.memoryStore,
        opts.ctx.workspaceRoot,
      ).assemble(req);
      if (opts.injectAssembledContext && assembled.systemExtras.length > 0) {
        systemExtra = [opts.system, ...assembled.systemExtras]
          .filter(Boolean)
          .join("\n\n");
      }
    } catch (err) {
      await opts.trace.append("info", {
        message: "context_assemble_skipped",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const system = composeSystem(systemExtra);

  const readUsage = (usage: unknown): { promptTokens: number; completionTokens: number } => {
    const u = (usage ?? {}) as Record<string, unknown>;
    const prompt = Number(
      u.promptTokens ?? u.inputTokens ?? u.prompt_tokens ?? u.input_tokens ?? 0,
    );
    const completion = Number(
      u.completionTokens ??
        u.outputTokens ??
        u.completion_tokens ??
        u.output_tokens ??
        0,
    );
    return {
      promptTokens: Number.isFinite(prompt) ? prompt : 0,
      completionTokens: Number.isFinite(completion) ? completion : 0,
    };
  };

  const onStepFinish = (
    step: {
      text?: string;
      finishReason?: string;
      toolCalls?: Array<{ toolName: string; args: unknown }>;
      usage?: unknown;
    },
  ) => {
    if (step.text) {
      opts.onText?.(step.text);
      void opts.trace?.append("assistant_text", {
        text: step.text.slice(0, 4000),
      });
    }
    void opts.trace?.append("model_step", {
      finishReason: step.finishReason,
      toolCalls: step.toolCalls?.map((c) => ({
        toolName: c.toolName,
        args: c.args,
      })),
      usage: step.usage,
    });
    const usage = readUsage(step.usage);
    totals.promptTokens += usage.promptTokens;
    totals.completionTokens += usage.completionTokens;
    opts.onUsage?.({ ...totals });
  };

  async function once(activeMessages: CoreMessage[]) {
    // maxRetries: 0 — we own 429/5xx backoff via withProviderRetry so the SDK
    // does not double-retry underneath us.
    return withProviderRetry(
      async () => {
        const result = streamText({
          model: resolved.model as Parameters<typeof streamText>[0]["model"],
          tools,
          maxSteps,
          maxRetries: 0,
          system,
          messages: activeMessages,
          experimental_repairToolCall: async ({
            toolCall,
            parameterSchema,
            error,
          }) => {
            await opts.trace?.append("tool_repair", {
              toolName: toolCall.toolName,
              error: error.message,
              args: toolCall.args,
            });
            const schema = parameterSchema({
              toolName: toolCall.toolName,
            }) as { properties?: Record<string, unknown>; required?: string[] };
            const repaired = repairToolArgs(
              toolCall.toolName,
              toolCall.args,
              schema,
            );
            if (!repaired) return null;
            return { ...toolCall, args: repaired };
          },
          onStepFinish,
        });

        // `await result.text` can hang with some OpenAI-compatible providers;
        // draining textStream drives multi-step tool loops to completion.
        let text = "";
        for await (const delta of result.textStream) {
          text += delta;
          if (delta) opts.onTextDelta?.(delta);
        }
        const [finishReason, steps, response, usage] = await Promise.all([
          result.finishReason,
          result.steps,
          result.response,
          result.usage,
        ]);
        const totalUsage =
          "totalUsage" in result
            ? await (result as { totalUsage: Promise<unknown> }).totalUsage
            : undefined;

        return {
          text,
          finishReason,
          steps,
          response,
          usage,
          totalUsage,
        };
      },
      {
        onStatus: opts.onStatus,
        onTrace: async (payload) => {
          await opts.trace?.append("info", payload);
        },
      },
    );
  }

  let result;
  try {
    result = await once(messages);
  } catch (err) {
    // Groq may reject invalid tool calls server-side; nudge and retry once.
    if (!isToolValidationError(err)) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    await opts.trace?.append("error", {
      message: detail,
      recovered: true,
    });
    const nudge: CoreMessage = {
      role: "user",
      content: `Your previous tool call was invalid (${detail.slice(0, 300)}). Retry with exact schema fields only — e.g. read({path}), glob({pattern:"**/*"}), edit({path,oldString,newString}), bash({command}).`,
    };
    result = await once([...messages, nudge]);
  }

  // Gemini sometimes returns finishReason "error" without throwing — treat as
  // a hard failure so callers (bench) do not score a silent early stop as a
  // normal completion.
  if (result.finishReason === "error") {
    const detail =
      (result as { error?: { message?: string } }).error?.message ??
      "model finished with finishReason=error";
    opts.onStatus?.({
      label: "provider error",
      detail: detail.slice(0, 200),
      level: "error",
      sticky: true,
    });
    throw new ProviderError(detail.slice(0, 400));
  }

  const nextMessages: CoreMessage[] = [
    ...messages,
    ...(result.response?.messages ?? [
      { role: "assistant" as const, content: result.text },
    ]),
  ];

  const finalUsage = readUsage(
    (result as { totalUsage?: unknown; usage?: unknown }).totalUsage ??
      (result as { usage?: unknown }).usage,
  );
  if (finalUsage.promptTokens > totals.promptTokens) {
    totals.promptTokens = finalUsage.promptTokens;
  }
  if (finalUsage.completionTokens > totals.completionTokens) {
    totals.completionTokens = finalUsage.completionTokens;
  }
  opts.onUsage?.({ ...totals });

  return {
    text: result.text,
    finishReason: result.finishReason,
    steps: result.steps?.length ?? 1,
    provider: resolved.provider,
    modelId: resolved.modelId,
    messages: nextMessages,
  };
}
