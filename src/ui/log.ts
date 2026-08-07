/**
 * ui/log — verbose, beautiful stdout renderer for `clai chat`.
 *
 * Same `UiBus` stream as the Ink shell, but every tool call, truncated I/O,
 * token tally, and subagent nest is printed — nothing stays hidden in the sidebar.
 */

import type { UiBus, UiEvent } from "./events.js";
import { formatCostPrecise, formatDuration, formatTokens, truncate } from "./components.js";
import { glyph, paintText, resetSgr } from "./theme.js";

export type LogPrinterOptions = {
  write?: (line: string) => void;
  /** Max bytes of tool input/output to print inline (full payload still in trace). */
  maxPayloadBytes?: number;
  /** Show session banner on first context event. */
  showBanner?: boolean;
};

const DEFAULT_MAX_PAYLOAD = 4_096;

function indent(depth: number): string {
  return depth > 0 ? "  ".repeat(depth) : "";
}

function toolVerb(tool: string): string {
  const verbs: Record<string, string> = {
    read: "Read",
    grep: "Grep",
    glob: "Glob",
    edit: "Edit",
    write: "Write",
    bash: "Bash",
    bash_bg: "Bash bg",
    bash_jobs: "Bash jobs",
    bash_output: "Bash out",
    bash_kill: "Bash kill",
    parallel: "Parallel",
    task: "Task",
    repo_intake: "Intake",
    lsp_definition: "LSP def",
    lsp_references: "LSP refs",
    lsp_diagnostics: "LSP diag",
  };
  return verbs[tool] ?? tool;
}

function toolSigil(tool: string): string {
  if (tool === "read") return glyph("sigilRead");
  if (tool === "grep" || tool === "glob" || tool === "parallel") {
    return glyph("sigilSearch");
  }
  if (tool === "task") return glyph("sigilTask");
  if (
    tool === "bash" ||
    tool === "bash_bg" ||
    tool === "bash_jobs" ||
    tool === "bash_output" ||
    tool === "bash_kill"
  ) {
    return glyph("sigilDefault");
  }
  return glyph("sigilDefault");
}

function serializePayload(value: unknown, maxBytes: number): { text: string; clipped: boolean } {
  if (value == null) return { text: "", clipped: false };
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return { text, clipped: false };
  const slice = text.slice(0, Math.max(1, maxBytes - 40));
  return {
    text: `${slice}\n… [${bytes - Buffer.byteLength(slice, "utf8")}B omitted — see trace]`,
    clipped: true,
  };
}

function formatPayloadBlock(
  label: string,
  value: unknown,
  depth: number,
  maxBytes: number,
): string[] {
  const { text, clipped } = serializePayload(value, maxBytes);
  if (!text.trim()) return [];
  const prefix = indent(depth + 1);
  const tag = paintText("clai.textFaint", clipped ? `${label} (truncated)` : label, {
    dim: true,
  });
  const lines = text.split(/\r?\n/);
  const rule = paintText("clai.borderSubtle", `${prefix}${glyph("leftRule")} `, { dim: true });
  return [
    `${prefix}${tag}`,
    ...lines.map((line) => `${rule}${paintText("clai.textMuted", line)}`),
  ];
}

function statusMark(level?: string, ok?: boolean): string {
  if (ok === true) return paintText("clai.success", "ok");
  if (ok === false || level === "error") return paintText("clai.error", "fail");
  if (level === "warn") return paintText("clai.warning", "warn");
  return paintText("clai.textFaint", "··", { dim: true });
}

function metricsLine(tokensIn: number, tokensOut: number, costUsd?: number): string {
  const parts = [
    paintText("clai.textFaint", "tokens", { dim: true }),
    paintText("clai.info", `${formatTokens(tokensIn)} in`),
    paintText("clai.textFaint", "·", { dim: true }),
    paintText("clai.info", `${formatTokens(tokensOut)} out`),
  ];
  if (costUsd != null) {
    parts.push(paintText("clai.textFaint", "·", { dim: true }));
    parts.push(paintText("clai.accent", formatCostPrecise(costUsd)));
  }
  return parts.join(" ");
}

function hr(width = 72): string {
  return paintText("clai.borderSubtle", glyph("hRule").repeat(width), { dim: true });
}

function printBanner(ctx: NonNullable<Extract<UiEvent, { type: "context" }>>): string[] {
  const lines: string[] = ["", hr()];
  const title = paintText("clai.accent", "clai chat", { dim: false });
  lines.push(`  ${title}  ${paintText("clai.textMuted", ctx.model ?? "", { dim: true })}`);
  if (ctx.cwd) {
    lines.push(
      `  ${paintText("clai.textFaint", "cwd", { dim: true })}  ${paintText("clai.text", ctx.cwd)}`,
    );
  }
  if (ctx.runId) {
    lines.push(
      `  ${paintText("clai.textFaint", "run", { dim: true })}  ${paintText("clai.textMuted", ctx.runId)}`,
    );
  }
  if (ctx.tracePath) {
    lines.push(
      `  ${paintText("clai.textFaint", "trace", { dim: true })}  ${paintText("clai.textMuted", ctx.tracePath)}`,
    );
  }
  if (ctx.sandboxMode) {
    lines.push(
      `  ${paintText("clai.textFaint", "sandbox", { dim: true })}  ${paintText("clai.textMuted", ctx.sandboxMode)}`,
    );
  }
  if (ctx.lsp?.length) {
    lines.push(
      `  ${paintText("clai.textFaint", "lsp", { dim: true })}  ${paintText("clai.textMuted", ctx.lsp.join(", "))}`,
    );
  }
  lines.push(hr(), "");
  return lines;
}

export function createLogPrinter(
  opts: LogPrinterOptions = {},
): (event: UiEvent) => void {
  const write = opts.write ?? ((line: string) => console.log(line));
  const maxPayload = opts.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD;
  const showBanner = opts.showBanner ?? true;

  let bannerShown = false;
  let subagentDepth = 0;
  const pendingCalls = new Map<string, { tool: string; group?: string; input?: unknown }>();
  const planSteps = new Map<string, string[]>();

  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let turn = 0;

  const print = (lines: string | string[]) => {
    for (const line of Array.isArray(lines) ? lines : [lines]) {
      if (line) write(line);
    }
  };

  return (event: UiEvent) => {
    switch (event.type) {
      case "context": {
        if (showBanner && !bannerShown) {
          print(printBanner(event));
          bannerShown = true;
        }
        return;
      }

      case "user": {
        turn += 1;
        print("");
        print(
          `${paintText("clai.accent", "you", { dim: false })} ${paintText("clai.textFaint", "›", { dim: true })} ${paintText("clai.text", event.text)}`,
        );
        print(paintText("clai.textFaint", "─".repeat(48), { dim: true }));
        return;
      }

      case "assistant": {
        if (!event.text.trim()) return;
        const prefix = paintText("clai.accent", "clai", { dim: false });
        for (const line of event.text.trimEnd().split(/\r?\n/)) {
          print(`${prefix} ${paintText("clai.text", line)}`);
        }
        if (event.done) {
          print("");
        }
        return;
      }

      case "thinking": {
        if (!event.text.trim()) return;
        print(
          paintText("clai.textMuted", `[think] ${truncate(event.text, 200)}`, {
            dim: true,
          }),
        );
        return;
      }

      case "tool_call": {
        pendingCalls.set(event.id, {
          tool: event.tool,
          group: event.group,
          input: event.input,
        });
        const depth =
          event.group === "subagent" && event.tool !== "task" ? subagentDepth + 1 : subagentDepth;
        if (event.tool === "task") {
          subagentDepth += 1;
          print("");
          print(
            `${indent(subagentDepth - 1)}${paintText("clai.accent", `${toolSigil("task")} subagent`, { dim: false })} ${paintText("clai.textMuted", truncate(event.target ?? "", 100))}`,
          );
        } else {
          const sigil = paintText("clai.accent", toolSigil(event.tool));
          const verb = paintText("clai.text", toolVerb(event.tool));
          const target = event.target
            ? paintText("clai.textMuted", `  ${truncate(event.target, 120)}`)
            : "";
          print(`${indent(depth)}${sigil} ${verb}${target}`);
        }
        if (event.input != null) {
          print(formatPayloadBlock("in", event.input, depth, maxPayload));
        }
        return;
      }

      case "tool_result": {
        const call = pendingCalls.get(event.id);
        pendingCalls.delete(event.id);
        const tool = event.tool ?? call?.tool ?? "tool";
        const group = event.group ?? call?.group;
        const depth = group === "subagent" && tool !== "task" ? subagentDepth : subagentDepth - 1;
        const dur =
          event.durationMs != null
            ? paintText("clai.textFaint", `  ${formatDuration(event.durationMs)}`, { dim: true })
            : "";
        const detail = event.detail
          ? paintText("clai.textMuted", `  ${truncate(event.detail, 160)}`)
          : "";
        print(
          `${indent(Math.max(0, depth))}[${statusMark(undefined, event.ok)}] ${paintText("clai.text", toolVerb(tool))}${detail}${dur}`,
        );
        if (event.output != null) {
          print(formatPayloadBlock("out", event.output, Math.max(0, depth), maxPayload));
        }
        if (tool === "task") {
          subagentDepth = Math.max(0, subagentDepth - 1);
          print(
            `${indent(subagentDepth)}${paintText("clai.textFaint", `${glyph("treeLast")} subagent done`, { dim: true })}`,
          );
          print("");
        }
        return;
      }

      case "metrics": {
        if (event.tokensIn != null) tokensIn = event.tokensIn;
        if (event.tokensOut != null) tokensOut = event.tokensOut;
        if (event.costUsd != null) costUsd = event.costUsd;
        print(metricsLine(tokensIn, tokensOut, costUsd));
        return;
      }

      case "status": {
        if (event.sticky) {
          const label = paintText(
            event.level === "error" ? "clai.error" : "clai.textMuted",
            event.label,
          );
          const detail = event.detail
            ? paintText("clai.textFaint", `  ${event.detail}`, { dim: true })
            : "";
          print(`${paintText("clai.textFaint", "··", { dim: true })} ${label}${detail}`);
        }
        return;
      }

      case "approval": {
        print(
          `[${paintText("clai.warning", event.decision ?? "gate")}] ${paintText("clai.text", "approval")}  ${event.tool}: ${truncate(event.request, 120)}`,
        );
        return;
      }

      case "verify": {
        print(
          `[${statusMark(undefined, event.ok)}] ${paintText("clai.text", "verify")}  ${event.label}${
            event.detail ? `  ${truncate(event.detail, 120)}` : ""
          }`,
        );
        return;
      }

      case "plan":
      case "todo": {
        const id = event.id ?? event.type;
        const states = event.steps.map((step) => step.state ?? "pending");
        const previous = planSteps.get(id);
        planSteps.set(id, states);

        if (!previous) {
          print(
            `${paintText("clai.info", `[${event.type}]`)} ${paintText("clai.text", event.title ?? event.type)}`,
          );
          for (const step of event.steps) {
            print(
              `       ${paintText("clai.textFaint", step.state ?? "pending", { dim: true })}  ${step.label}`,
            );
          }
          return;
        }
        event.steps.forEach((step, index) => {
          if (previous[index] !== states[index]) {
            print(
              `[${event.type}] ${step.label} → ${paintText("clai.accent", states[index] ?? "pending")}`,
            );
          }
        });
        return;
      }

      default:
        return;
    }
  };
}

/** Print events as they arrive. Returns an unsubscribe function. */
export function attachLogPrinter(
  bus: UiBus,
  opts: LogPrinterOptions = {},
): () => void {
  return bus.subscribe(createLogPrinter(opts));
}

export function formatTurnSummary(summary: {
  turn: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  steps?: number;
  finishReason?: string;
}): string {
  const parts = [
    paintText("clai.textFaint", `turn ${summary.turn} complete`, { dim: true }),
    metricsLine(summary.tokensIn, summary.tokensOut, summary.costUsd),
  ];
  if (summary.steps != null) {
    parts.push(paintText("clai.textFaint", `· ${summary.steps} steps`, { dim: true }));
  }
  if (summary.finishReason) {
    parts.push(paintText("clai.textFaint", `· ${summary.finishReason}`, { dim: true }));
  }
  return parts.join("  ");
}

export { resetSgr };
