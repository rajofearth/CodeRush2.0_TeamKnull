/**
 * session/interactive — chat log-mode session loop.
 */

import type { CoreMessage } from "ai";
import { estimateUsdBench } from "../bench/pricing.js";
import type { Workspace } from "../workspace.js";
import type { UiBus } from "../ui/events.js";
import { createToolPlaneBridge } from "../ui/bridge.js";

export type SessionSummary = {
  runId: string;
  tracePath: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  turns: number;
  ok: boolean;
};

const CHAT_SYSTEM = `## Chat log mode — delegate aggressively
You are in verbose log mode where every tool call and subagent step is printed.
Use the \`task\` tool liberally: spawn subagents (explore or general) for any exploration spanning more than 2–3 files, parallel investigations, or "how does X work" questions.
Emit multiple \`task\` calls in one step to run subagents in parallel.
Prefer multiple focused subagents over doing broad grep/read yourself — keep your context lean and synthesize their summaries in prose.
Long builds/servers: \`bash_bg\` + \`bash_output\` / \`bash_kill\`.
Do not dump raw tool output in your replies; the user already sees it in the log.`;

export function extraSystemForMode(mode: "log" | "tui" | "headless", extra?: string): string | undefined {
  const parts: string[] = [];
  if (mode === "log") parts.push(CHAT_SYSTEM);
  if (extra) parts.push(extra);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export type ChatLoopOptions = {
  workspace: Workspace;
  bus: UiBus;
  initialPrompt?: string;
  extraSystem?: string;
  onTurnComplete?: (info: {
    turn: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    finishReason: string;
    steps: number;
  }) => void;
};

/** Multi-turn stdin loop for `clai chat`. */
export async function runChatLoop(opts: ChatLoopOptions): Promise<SessionSummary> {
  const { createInterface } = await import("node:readline/promises");
  const { attachLogPrinter, formatTurnSummary } = await import("../ui/log.js");

  attachLogPrinter(opts.bus);

  const cwd = opts.workspace.root;
  const { hasApiKey, runAgentLoop, resolveModel } = await import("../adapter/index.js");
  const { createSandbox } = await import("../sandbox/index.js");
  const { createTraceWriter } = await import("../trace/index.js");
  const { intakeTool, probeLspAvailability } = await import("../tools/index.js");

  if (!hasApiKey()) {
    throw new Error(
      "No API key. Set GROQ_API_KEY (default), or OPENROUTER/CEREBRAS/OPENAI/ANTHROPIC/GEMINI/DEEPSEEK/AI_GATEWAY — or use `clai demo`.",
    );
  }

  const sandbox = await createSandbox({
    workspaceRoot: cwd,
    autoApprove: process.env.CLAI_AUTO_APPROVE === "1",
  });
  const { ShellJobManager } = await import("../shell/jobs.js");
  const shellJobs = new ShellJobManager({
    workspaceRoot: cwd,
    requestApproval: sandbox.requestApproval,
  });
  const trace = await createTraceWriter({
    cwd,
    tracesDir: opts.workspace.tracesDir,
  });
  const lsp = await probeLspAvailability(cwd);
  const lspNames = lsp.filter((s) => s.available).map((s) => s.engine);
  const model = await resolveModel();
  const { openMemoryStore } = await import("../memory/index.js");
  const memoryStore = await openMemoryStore({
    directory: opts.workspace.dataDir,
  });

  let history: CoreMessage[] = [];
  let turnCount = 0;
  let running = false;
  let intakeSeed = "";
  let lastTurnFailed = false;
  let sessionTokensIn = 0;
  let sessionTokensOut = 0;
  let sessionCostUsd = 0;

  const toolBridge = createToolPlaneBridge(opts.bus);
  const ctx = {
    workspaceRoot: cwd,
    sandbox,
    shellJobs,
    trace,
    onEvent: toolBridge,
  };

  opts.bus.emit({
    type: "context",
    cwd,
    runId: trace.runId,
    sandboxMode: sandbox.mode,
    model: `${model.provider}/${model.modelId}`,
    tracePath: trace.path,
    lsp: lspNames,
    agent: "chat",
  });

  async function ensureIntake(): Promise<void> {
    if (intakeSeed) return;
    opts.bus.emit({ type: "status", label: "intake scan" });
    const intake = await intakeTool(ctx, {});
    if (intake.ok && intake.map && typeof intake.map === "object") {
      const map = intake.map as { summary?: string };
      intakeSeed = map.summary ? `Project: ${map.summary}.` : "";
    }
    opts.bus.emit({ type: "status", label: "ready", done: true });
  }

  async function runTurn(prompt: string): Promise<{
    finishReason: string;
    steps: number;
  }> {
    if (running) return { finishReason: "busy", steps: 0 };
    running = true;
    lastTurnFailed = false;
    turnCount += 1;
    let segment = 0;
    const assistantId = () => `turn-${turnCount}-s${segment}`;
    const thinkId = `turn-${turnCount}-think`;
    let sawDelta = false;
    let thinkingOpen = false;
    let needNewSegment = false;
    let turnTokensIn = 0;
    let turnTokensOut = 0;

    const sealThinking = () => {
      if (!thinkingOpen) return;
      opts.bus.emit({
        type: "thinking",
        id: thinkId,
        text: "",
        done: true,
      });
      thinkingOpen = false;
    };

    const sealAssistant = () => {
      if (sawDelta) {
        opts.bus.emit({
          type: "assistant",
          id: assistantId(),
          text: "",
          done: true,
        });
        sawDelta = false;
      }
    };

    ctx.onEvent = (ev) => {
      if (ev.type === "tool_call") {
        sealThinking();
        sealAssistant();
        needNewSegment = true;
      }
      toolBridge(ev);
    };

    opts.bus.emit({ type: "user", text: prompt });
    opts.bus.emit({ type: "status", label: "working" });

    try {
      await ensureIntake();
      const systemExtra = extraSystemForMode("log", opts.extraSystem);
      const result = await runAgentLoop({
        ctx,
        prompt,
        history,
        system: [
          intakeSeed ? `Repository intake notes:\n${intakeSeed}` : "",
          systemExtra ?? "",
        ]
          .filter(Boolean)
          .join("\n\n") || undefined,
        trace,
        model,
        memoryStore,
        agentRole: "chat",
        onStatus: (status) =>
          opts.bus.emit({
            type: "status",
            label: status.label,
            detail: status.detail,
            level: status.level,
            done: status.done,
            sticky: status.sticky,
          }),
        onThinkingDelta: (delta) => {
          thinkingOpen = true;
          opts.bus.emit({
            type: "thinking",
            id: thinkId,
            text: delta,
            done: false,
          });
        },
        onTextDelta: (delta) => {
          sealThinking();
          if (needNewSegment) {
            segment += 1;
            needNewSegment = false;
          }
          opts.bus.emit({
            type: "assistant",
            id: assistantId(),
            text: delta,
            done: false,
          });
          sawDelta = true;
        },
        onText: (text) => {
          sealThinking();
          if (sawDelta) {
            opts.bus.emit({
              type: "assistant",
              id: assistantId(),
              text: "",
              done: true,
            });
          } else if (text.trim()) {
            if (needNewSegment) {
              segment += 1;
              needNewSegment = false;
            }
            opts.bus.emit({
              type: "assistant",
              id: assistantId(),
              text,
              done: true,
            });
          }
          sawDelta = false;
        },
        onUsage: (usage) => {
          const deltaIn = usage.promptTokens - turnTokensIn;
          const deltaOut = usage.completionTokens - turnTokensOut;
          turnTokensIn = usage.promptTokens;
          turnTokensOut = usage.completionTokens;
          sessionTokensIn += deltaIn;
          sessionTokensOut += deltaOut;
          sessionCostUsd = estimateUsdBench(
            model.provider,
            sessionTokensIn,
            sessionTokensOut,
          );
          opts.bus.emit({
            type: "metrics",
            tokensIn: sessionTokensIn,
            tokensOut: sessionTokensOut,
            costUsd: sessionCostUsd,
          });
        },
      });
      history = result.messages;
      sealAssistant();
      opts.bus.emit({
        type: "status",
        label: "processed",
        detail: `${result.finishReason} · ${result.steps} steps`,
        sticky: true,
        done: true,
      });
      opts.onTurnComplete?.({
        turn: turnCount,
        tokensIn: turnTokensIn,
        tokensOut: turnTokensOut,
        costUsd: estimateUsdBench(
          model.provider,
          turnTokensIn,
          turnTokensOut,
        ),
        finishReason: result.finishReason,
        steps: result.steps,
      });
      console.log(formatTurnSummary({
        turn: turnCount,
        tokensIn: turnTokensIn,
        tokensOut: turnTokensOut,
        costUsd: estimateUsdBench(
          model.provider,
          turnTokensIn,
          turnTokensOut,
        ),
        steps: result.steps,
        finishReason: result.finishReason,
      }));
      return result;
    } catch (err) {
      lastTurnFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      await trace.append("error", { message: msg });
      opts.bus.emit({
        type: "status",
        label: "error",
        detail: msg,
        level: "error",
        sticky: true,
        done: true,
      });
      return { finishReason: "error", steps: 0 };
    } finally {
      running = false;
    }
  }

  if (opts.initialPrompt) {
    await runTurn(opts.initialPrompt);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  console.log("");
  console.log(
    "  chat ready — type a message, /exit to quit, /clear to reset history",
  );
  console.log("");

  try {
    while (true) {
      const line = (await rl.question("  › ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      if (line === "/clear") {
        history = [];
        console.log("  history cleared");
        continue;
      }
      await runTurn(line);
      console.log("");
    }
  } finally {
    rl.close();
    shellJobs.dispose();
    memoryStore.close();
    await trace.close(lastTurnFailed ? "fail" : "ok");
    await sandbox.dispose();
  }

  return {
    runId: trace.runId,
    tracePath: trace.path,
    tokensIn: sessionTokensIn,
    tokensOut: sessionTokensOut,
    costUsd: sessionCostUsd,
    turns: turnCount,
    ok: !lastTurnFailed,
  };
}
