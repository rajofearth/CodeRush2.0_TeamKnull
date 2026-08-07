/**
 * adapter — Vercel AI SDK soft agent loop + pluggable providers.
 * Default: Cerebras via CEREBRAS_API_KEY; swap with CLAI_PROVIDER.
 */

import { generateText, type CoreMessage } from "ai";
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

/** True when at least one registered provider key is present. */
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
};

const DEFAULT_SYSTEM = `You are CLAI, a coding agent. Use tools to explore and edit the workspace.
Prefer read-only discovery (grep/glob/read) before edits. After editing, run a command to verify when useful.
Soft completion: stop when the task looks done — there is no hard finish gate. Be concise.`;

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

  const messages: CoreMessage[] = [{ role: "user", content: opts.prompt }];
  const totals = { promptTokens: 0, completionTokens: 0 };

  const result = await generateText({
    model: resolved.model as Parameters<typeof generateText>[0]["model"],
    tools,
    maxSteps,
    system: opts.system ?? DEFAULT_SYSTEM,
    messages,
    onStepFinish: async (step) => {
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
    },
  });

  return {
    text: result.text,
    finishReason: result.finishReason,
    steps: result.steps?.length ?? 1,
    provider: resolved.provider,
    modelId: resolved.modelId,
  };
}
