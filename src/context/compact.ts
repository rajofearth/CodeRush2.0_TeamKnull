/**
 * compact — deterministic context compaction for the agent loop.
 *
 * When assembled history approaches the model's context budget (chars/4
 * token heuristic), older turns are replaced with a structured digest:
 * tool call/result pairs collapse to one-line outcomes, superseded file
 * reads are dropped, stale assistant prose is truncated. The system prompt,
 * the original user task, and the last N messages are kept verbatim.
 *
 * No extra model call — this is a pure function over the message list.
 */

import type { CoreMessage } from "ai";

export type CompactionConfig = {
  /** Approx token count at which compaction triggers. */
  thresholdTokens: number;
  /** How many trailing messages to keep verbatim. */
  keepRecentMessages: number;
};

const DEFAULT_THRESHOLD_TOKENS = 45_000;
const DEFAULT_KEEP_RECENT = 10;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function compactionConfigFromEnv(): CompactionConfig {
  return {
    thresholdTokens: envInt("CLAI_COMPACT_THRESHOLD_TOKENS", DEFAULT_THRESHOLD_TOKENS),
    keepRecentMessages: envInt("CLAI_COMPACT_KEEP_TURNS", DEFAULT_KEEP_RECENT),
  };
}

/** chars/4 heuristic — good enough for a trigger threshold. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageText(message: CoreMessage): string {
  if (typeof message.content === "string") return message.content;
  try {
    return JSON.stringify(message.content);
  } catch {
    return "";
  }
}

export function estimateMessagesTokens(messages: CoreMessage[]): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(messageText(m)) + 4;
  return total;
}

type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
};

type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName?: string;
  result: unknown;
};

function isPartArray(content: unknown): content is Array<Record<string, unknown>> {
  return Array.isArray(content);
}

function shortArg(args: unknown): string {
  if (args == null) return "";
  if (typeof args !== "object") return String(args).slice(0, 80);
  const rec = args as Record<string, unknown>;
  const key =
    rec.path ?? rec.pattern ?? rec.command ?? rec.prompt ?? rec.target ?? "";
  return String(key).slice(0, 80);
}

function outcomeLine(toolName: string, args: unknown, result: unknown): string {
  const target = shortArg(args);
  let status = "done";
  if (result && typeof result === "object") {
    const rec = result as Record<string, unknown>;
    if (rec.ok === false) {
      status = `failed${rec.error ? `: ${String(rec.error).slice(0, 80)}` : ""}`;
    } else if (toolName === "read" && typeof rec.totalLines === "number") {
      status = `${rec.totalLines} lines`;
    } else if (typeof rec.count === "number") {
      status = `${rec.count} results`;
    } else if (toolName === "bash" && typeof rec.exitCode === "number") {
      status = `exit ${rec.exitCode}`;
    } else if (toolName === "edit" || toolName === "write") {
      status = "ok";
    }
  }
  return `${toolName}(${target}) → ${status}`;
}

export type CompactionResult = {
  messages: CoreMessage[];
  compacted: boolean;
  beforeTokens: number;
  afterTokens: number;
  droppedMessages: number;
};

/**
 * Compact `messages` if the estimate exceeds the threshold.
 * Keeps message[0..firstUserIndex] (original task) and the last
 * `keepRecentMessages` verbatim; digests everything in between.
 */
export function compactHistory(
  messages: CoreMessage[],
  cfg: CompactionConfig = compactionConfigFromEnv(),
): CompactionResult {
  const beforeTokens = estimateMessagesTokens(messages);
  const noop: CompactionResult = {
    messages,
    compacted: false,
    beforeTokens,
    afterTokens: beforeTokens,
    droppedMessages: 0,
  };
  if (beforeTokens <= cfg.thresholdTokens) return noop;

  // Keep the original task: everything up to and including the first user msg.
  const firstUser = messages.findIndex((m) => m.role === "user");
  const headEnd = firstUser >= 0 ? firstUser + 1 : 0;

  let tailStart = Math.max(headEnd, messages.length - cfg.keepRecentMessages);
  // Never split an assistant tool-call from its tool-result messages:
  // a "tool" role message must follow its assistant message.
  while (tailStart > headEnd && messages[tailStart]?.role === "tool") {
    tailStart -= 1;
  }
  if (tailStart <= headEnd) return noop;

  const middle = messages.slice(headEnd, tailStart);

  // Build the digest.
  const pendingCalls = new Map<string, { toolName: string; args: unknown }>();
  const toolLines: string[] = [];
  const readLineIndexByPath = new Map<string, number>();
  const notes: string[] = [];
  const filesTouched = new Set<string>();

  for (const message of middle) {
    if (message.role === "user") {
      const text = messageText(message).slice(0, 200);
      if (text.trim()) notes.push(`user: ${text}`);
      continue;
    }
    if (message.role === "assistant") {
      if (typeof message.content === "string") {
        const text = message.content.slice(0, 200);
        if (text.trim()) notes.push(`assistant: ${text}`);
        continue;
      }
      if (isPartArray(message.content)) {
        for (const part of message.content) {
          if (part.type === "text" && typeof part.text === "string") {
            const text = part.text.slice(0, 200);
            if (text.trim()) notes.push(`assistant: ${text}`);
          } else if (part.type === "tool-call") {
            const call = part as unknown as ToolCallPart;
            pendingCalls.set(call.toolCallId, {
              toolName: call.toolName,
              args: call.args,
            });
          }
        }
      }
      continue;
    }
    if (message.role === "tool" && isPartArray(message.content)) {
      for (const part of message.content) {
        if (part.type !== "tool-result") continue;
        const res = part as unknown as ToolResultPart;
        const call = pendingCalls.get(res.toolCallId);
        const toolName = call?.toolName ?? res.toolName ?? "tool";
        const line = outcomeLine(toolName, call?.args, res.result);
        if (toolName === "read") {
          // Superseded reads: keep only the latest read of the same path.
          const target = shortArg(call?.args);
          const prior = readLineIndexByPath.get(target);
          if (prior !== undefined) toolLines[prior] = "";
          readLineIndexByPath.set(target, toolLines.length);
        }
        if (
          (toolName === "edit" || toolName === "write") &&
          call?.args &&
          typeof call.args === "object" &&
          "path" in (call.args as Record<string, unknown>)
        ) {
          filesTouched.add(String((call.args as Record<string, unknown>).path));
        }
        toolLines.push(line);
        pendingCalls.delete(res.toolCallId);
      }
    }
  }

  const digestSections: string[] = [
    `[CONVERSATION DIGEST — ${middle.length} earlier messages compacted; full detail in the run trace]`,
  ];
  if (filesTouched.size > 0) {
    digestSections.push(`Files modified:\n${[...filesTouched].map((f) => `- ${f}`).join("\n")}`);
  }
  const cleanedToolLines = toolLines.filter(Boolean);
  if (cleanedToolLines.length > 0) {
    digestSections.push(`Tool outcomes:\n${cleanedToolLines.map((l) => `- ${l}`).join("\n")}`);
  }
  if (notes.length > 0) {
    // Keep the most recent notes — older prose is the most stale.
    digestSections.push(`Notes:\n${notes.slice(-12).map((n) => `- ${n}`).join("\n")}`);
  }

  const digestMessage: CoreMessage = {
    role: "user",
    content: digestSections.join("\n\n"),
  };

  const compactedMessages: CoreMessage[] = [
    ...messages.slice(0, headEnd),
    digestMessage,
    ...messages.slice(tailStart),
  ];
  const afterTokens = estimateMessagesTokens(compactedMessages);

  // Compaction must actually help; otherwise leave history alone.
  if (afterTokens >= beforeTokens) return noop;

  return {
    messages: compactedMessages,
    compacted: true,
    beforeTokens,
    afterTokens,
    droppedMessages: middle.length,
  };
}

/** Human-readable token label, e.g. 41230 → "41k". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}
