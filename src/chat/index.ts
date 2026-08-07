/**
 * chat — verbose log-mode interactive session (`clai chat`).
 *
 * Same agent loop as the TUI, but every tool call, truncated I/O, subagent
 * nest, token tally, and cost line is printed to stdout. Multi-turn via stdin.
 */

import type { Workspace } from "../workspace.js";
import { createUiBus } from "../ui/events.js";
import { runChatLoop } from "../session/interactive.js";
import { formatCostPrecise, formatTokens } from "../ui/components.js";
import { paintText } from "../ui/theme.js";

function positionalPrompt(args: string[]): string | undefined {
  const rest = args.filter(
    (a) => !a.startsWith("-") && a !== "chat",
  );
  if (rest.length === 0) return undefined;
  return rest.join(" ");
}

export async function runChatCli(
  args: string[],
  workspace: Workspace,
): Promise<number> {
  const initialPrompt = positionalPrompt(args);

  const bus = createUiBus();

  try {
    const summary = await runChatLoop({
      workspace,
      bus,
      initialPrompt,
    });

    console.log("");
    console.log(
      paintText("clai.textFaint", "session", { dim: true }),
      paintText("clai.textMuted", summary.runId),
      "·",
      paintText("clai.info", `${formatTokens(summary.tokensIn)} in / ${formatTokens(summary.tokensOut)} out`),
      "·",
      paintText("clai.accent", formatCostPrecise(summary.costUsd)),
      "·",
      paintText("clai.textMuted", summary.tracePath),
    );
    console.log(
      paintText(
        "clai.textFaint",
        "  smart context was on — prompt clean · compact · task fold · overflow retry",
        { dim: true },
      ),
    );
    console.log("");

    return summary.ok ? 0 : 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`clai chat: ${msg}`);
    return 1;
  }
}
