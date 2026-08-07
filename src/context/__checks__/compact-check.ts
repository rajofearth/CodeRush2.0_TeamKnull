/**
 * Quick self-check for smart compaction + prompt cleaning.
 * Run: pnpm exec tsx src/context/__checks__/compact-check.ts
 */
import type { CoreMessage } from "ai";
import {
  compactHistory,
  compactParallelTaskResults,
  estimateMessagesTokens,
} from "../compact.js";
import { cleanUserPrompt } from "../prompt-clean.js";
import {
  isContextOverflowError,
  resolveContextWindow,
} from "../windows.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// --- prompt clean ---
{
  const r = cleanUserPrompt(
    "Hey, can you please help me to fix the bug in src/foo.ts thanks!!!",
  );
  assert(r.changed, "expected filler stripped");
  assert(r.cleaned.includes("src/foo.ts"), "must keep path");
  assert(r.cleaned.includes("fix") || r.cleaned.includes("bug"), "must keep ask");
  assert(!/^hey/i.test(r.cleaned), "leading hey gone");
}

{
  const code = "Please fix:\n```\ncan you please\n```\nthanks";
  const r = cleanUserPrompt(code);
  assert(r.cleaned.includes("```\ncan you please\n```"), "code fence preserved");
}

{
  const r = cleanUserPrompt("rename foo to bar");
  assert(!r.changed || r.cleaned === "rename foo to bar", "clean prompts stay intact");
}

// --- windows ---
{
  const w = resolveContextWindow({ provider: "groq", modelId: "openai/gpt-oss-20b" });
  assert(w.windowTokens >= 32_000, "window set");
  assert(w.softThresholdTokens < w.hardThresholdTokens, "soft < hard");
  assert(isContextOverflowError(new Error("context_length_exceeded")), "overflow detect");
  assert(!isContextOverflowError(new Error("rate limit")), "not overflow");
}

// --- history compact ---
{
  const msgs: CoreMessage[] = [
    { role: "user", content: "fix the parser" },
  ];
  for (let i = 0; i < 30; i++) {
    msgs.push({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: `c${i}`,
          toolName: "read",
          args: { path: `file${i}.ts` },
        },
      ],
    } as CoreMessage);
    msgs.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: `c${i}`,
          toolName: "read",
          result: {
            ok: true,
            tool: "read",
            totalLines: 100,
            lines: Array.from({ length: 40 }, (_, n) => ({
              line: n + 1,
              text: `line ${n} `.repeat(20),
            })),
          },
        },
      ],
    } as CoreMessage);
  }
  const before = estimateMessagesTokens(msgs);
  const result = compactHistory(msgs, {
    thresholdTokens: 100,
    keepRecentMessages: 4,
    mode: "normal",
  });
  assert(result.compacted, "should compact bulky history");
  assert(result.afterTokens < before, "tokens drop");
  assert(
    typeof result.messages[1]?.content === "string" &&
      String(result.messages[1].content).includes("CONVERSATION DIGEST"),
    "digest present",
  );
}

// --- parallel task fold ---
{
  const long = "finding ".repeat(200);
  const msgs: CoreMessage[] = [
    { role: "user", content: "explore" },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "t1",
          result: { ok: true, tool: "task", agent: "explore", summary: long },
        },
        {
          type: "tool-result",
          toolCallId: "t2",
          result: { ok: true, tool: "task", agent: "explore", summary: long },
        },
      ],
    } as CoreMessage,
  ];
  const folded = compactParallelTaskResults(msgs, { maxSummaryChars: 100 });
  assert(folded.compacted, "parallel tasks folded");
  const parts = (folded.messages[1] as { content: Array<{ result: { summary: string } }> })
    .content;
  assert(parts[0]!.result.summary.length < long.length, "summary shortened");
}

// --- task findings in digest ---
{
  const msgs: CoreMessage[] = [
    { role: "user", content: "map the auth system" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "a1",
          toolName: "task",
          args: { prompt: "find login flow" },
        },
      ],
    } as CoreMessage,
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "a1",
          result: {
            ok: true,
            tool: "task",
            agent: "explore",
            summary: "Login starts in src/auth/login.ts line 12",
          },
        },
      ],
    } as CoreMessage,
    { role: "assistant", content: "pad ".repeat(5000) },
    { role: "user", content: "continue" },
    { role: "assistant", content: "ok" },
  ];
  const result = compactHistory(msgs, {
    thresholdTokens: 10,
    keepRecentMessages: 2,
  });
  assert(result.compacted, "task history compacted");
  const digest = String(result.messages.find((m) => m.role === "user" && String(m.content).includes("DIGEST"))?.content ?? "");
  assert(digest.includes("Subagent findings"), "task findings section");
  assert(digest.includes("login"), "keeps finding text");
}

console.log("compact-check: ok");
