/**
 * adapter — Vercel AI SDK soft agent loop + pluggable providers.
 * Default: Groq (OpenAI-compatible) via GROQ_API_KEY.
 */

import {
  generateText,
  InvalidToolArgumentsError,
  NoSuchToolError,
  type CoreMessage,
} from "ai";
import type { ToolContext } from "../tools/index.js";
import { createAiTools } from "../tools/index.js";
import type { TraceWriter } from "../trace/index.js";
import {
  createProviderHandle,
  hasAnyProviderKey,
  type ProviderHandle,
  type ProviderId,
} from "./providers.js";

export type { ProviderId, ProviderHandle } from "./providers.js";
export { listProviders, DEFAULT_PROVIDER } from "./providers.js";

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
  system?: string;
  maxSteps?: number;
  model?: ResolvedModel;
  trace?: TraceWriter;
  onText?: (text: string) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
  }) => void;
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
Prefer read-only discovery (grep/glob/read/repo_intake/LSP) before edits.
Use lsp_diagnostics after edits on TS/Python; lsp_definition / lsp_references for navigation.
After editing, run a command to verify when useful.
Soft completion: stop when the task looks done — there is no hard finish gate. Be concise.
Tool tips: glob pattern use **/* ; read only needs path; edit needs path+oldString+newString; bash only needs command.`;

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
  const tools = createAiTools(opts.ctx);
  const maxSteps = opts.maxSteps ?? 12;

  await opts.trace?.append("model_step", {
    provider: resolved.provider,
    modelId: resolved.modelId,
    maxSteps,
    prompt: opts.prompt.slice(0, 500),
  });

  const messages: CoreMessage[] = [
    ...(opts.history ?? []),
    { role: "user", content: opts.prompt },
  ];
  const totals = { promptTokens: 0, completionTokens: 0 };

  const onStepFinish = async (
    step: {
      text?: string;
      finishReason?: string;
      toolCalls?: Array<{ toolName: string; args: unknown }>;
      usage?: { promptTokens?: number; completionTokens?: number };
    },
  ) => {
    if (step.text) {
      opts.onText?.(step.text);
      await opts.trace?.append("assistant_text", {
        text: step.text.slice(0, 4000),
      });
    }
    await opts.trace?.append("model_step", {
      finishReason: step.finishReason,
      toolCalls: step.toolCalls?.map((c) => ({
        toolName: c.toolName,
        args: c.args,
      })),
      usage: step.usage,
    });
    totals.promptTokens += step.usage?.promptTokens ?? 0;
    totals.completionTokens += step.usage?.completionTokens ?? 0;
    opts.onUsage?.({ ...totals });
  };

  async function once(activeMessages: CoreMessage[]) {
    return generateText({
      model: resolved.model as Parameters<typeof generateText>[0]["model"],
      tools,
      maxSteps,
      system: opts.system ?? DEFAULT_SYSTEM,
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

  const nextMessages: CoreMessage[] = [
    ...messages,
    ...(result.response?.messages ?? [
      { role: "assistant" as const, content: result.text },
    ]),
  ];

  return {
    text: result.text,
    finishReason: result.finishReason,
    steps: result.steps?.length ?? 1,
    provider: resolved.provider,
    modelId: resolved.modelId,
    messages: nextMessages,
  };
}
