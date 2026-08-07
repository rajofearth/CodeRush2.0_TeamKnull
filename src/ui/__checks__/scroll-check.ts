/**
 * ui/__checks__/scroll-check — line-based transcript windowing.
 *
 *   pnpm exec tsx src/ui/__checks__/scroll-check.ts
 */

import {
  groupItems,
  initialUiState,
  reduceUiEvent,
  type RenderBlock,
} from "../state.js";
import {
  measureBlockHeight,
  measureHeights,
  windowByLines,
} from "../scroll.js";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function assert(name: string, cond: boolean, detail?: string): void {
  checks.push({ name, ok: cond, detail: cond ? undefined : detail });
}

function tallAssistant(lines: number): RenderBlock {
  const text = Array.from({ length: lines }, (_, i) => `line-${i}`).join("\n");
  return {
    kind: "single",
    item: { kind: "assistant", id: "tall", text, done: true },
  };
}

function main(): void {
  const width = 70;
  const tall = tallAssistant(40);
  const h = measureBlockHeight(tall, width);
  assert(
    "tall assistant height >= 40",
    h >= 40,
    `height=${h}`,
  );

  const blocks = [tall];
  const heights = measureHeights(blocks, width);
  const viewport = 20;
  const atEnd = windowByLines(blocks, heights, viewport, 0);
  assert(
    "maxScroll >= 20 for tall reply",
    atEnd.maxScroll >= 20,
    `maxScroll=${atEnd.maxScroll} total=${atEnd.totalLines} h=${heights[0]}`,
  );
  assert("scrollFromBottom=0 is at bottom", atEnd.atBottom === true);
  assert(
    "follow shows end (hiddenBelow=0)",
    atEnd.hiddenBelowLines === 0,
    `hiddenBelow=${atEnd.hiddenBelowLines}`,
  );
  assert(
    "follow clips top of tall message",
    atEnd.clipTop > 0 && atEnd.hiddenAboveLines > 0,
    `clipTop=${atEnd.clipTop} hiddenAbove=${atEnd.hiddenAboveLines}`,
  );

  const atStart = windowByLines(
    blocks,
    heights,
    viewport,
    atEnd.maxScroll,
  );
  assert(
    "scrollFromBottom=maxScroll shows start",
    atStart.hiddenAboveLines === 0 && atStart.clipTop === 0,
    `hiddenAbove=${atStart.hiddenAboveLines} clipTop=${atStart.clipTop}`,
  );
  assert(
    "at start: has content below toward live edge",
    atStart.hiddenBelowLines > 0 && !atStart.atBottom,
    `below=${atStart.hiddenBelowLines}`,
  );

  // Mid-message: between follow and start, clipTop stays positive while scrolled.
  const midScroll = Math.floor(atEnd.maxScroll / 2);
  const mid = windowByLines(blocks, heights, viewport, midScroll);
  assert(
    "mid-scroll still inside tall message with clipTop",
    mid.visible.length === 1 && mid.clipTop > 0,
    `clipTop=${mid.clipTop} visible=${mid.visible.length}`,
  );

  // Page step: viewport − 1 lines changes the window.
  const page = Math.max(1, viewport - 1);
  const page0 = windowByLines(blocks, heights, viewport, 0);
  const page1 = windowByLines(blocks, heights, viewport, page);
  assert(
    "page step reduces hiddenAbove (reveal older lines)",
    page1.hiddenAboveLines < page0.hiddenAboveLines,
    `p0 above=${page0.hiddenAboveLines}; p1 above=${page1.hiddenAboveLines} page=${page}`,
  );
  assert(
    "page step moves by ≈ viewport-1 lines",
    page0.hiddenAboveLines - page1.hiddenAboveLines === page,
    `delta=${page0.hiddenAboveLines - page1.hiddenAboveLines} page=${page}`,
  );

  // Chronology: thinking → tools → reply stays ordered in the window.
  let state = initialUiState();
  state = reduceUiEvent(state, {
    type: "thinking",
    id: "th",
    text: "plan",
    done: true,
  });
  state = reduceUiEvent(state, {
    type: "tool_call",
    id: "t1",
    tool: "read",
    target: "a.ts",
    group: "explore",
  });
  state = reduceUiEvent(state, {
    type: "tool_result",
    id: "t1",
    tool: "read",
    ok: true,
  });
  state = reduceUiEvent(state, {
    type: "assistant",
    id: "a",
    text: "done",
    done: true,
  });
  const chronoBlocks = groupItems(state.items);
  const chronoHeights = measureHeights(chronoBlocks, width);
  const chronoWin = windowByLines(chronoBlocks, chronoHeights, 40, 0);
  const kinds = chronoWin.visible.map((b) =>
    b.kind === "toolGroup" ? "toolGroup" : b.item.kind,
  );
  assert(
    "chronology thinking → tools → reply",
    kinds.join(",") === "thinking,toolGroup,assistant",
    `got ${kinds.join(",")}`,
  );

  // Gap between non-tool blocks is counted.
  const userThenAsst: RenderBlock[] = [
    {
      kind: "single",
      item: { kind: "user", id: "u", text: "hi" },
    },
    {
      kind: "single",
      item: { kind: "assistant", id: "a2", text: "yo", done: true },
    },
  ];
  const withGap = measureHeights(userThenAsst, width);
  const bare =
    measureBlockHeight(userThenAsst[0]!, width) +
    measureBlockHeight(userThenAsst[1]!, width);
  assert(
    "gapBefore adds +1 between user/assistant",
    withGap.reduce((a, b) => a + b, 0) === bare + 1,
    `sum=${withGap.reduce((a, b) => a + b, 0)} bare=${bare}`,
  );

  // Done assistant: body only (no status, no marginBottom).
  const doneAsst: RenderBlock = {
    kind: "single",
    item: { kind: "assistant", id: "d", text: "one line", done: true },
  };
  assert(
    "done assistant height is body only",
    measureBlockHeight(doneAsst, width) === 1,
    `h=${measureBlockHeight(doneAsst, width)}`,
  );
  const liveAsst: RenderBlock = {
    kind: "single",
    item: { kind: "assistant", id: "l", text: "one line", done: false },
  };
  assert(
    "streaming assistant adds status line",
    measureBlockHeight(liveAsst, width) === 2,
    `h=${measureBlockHeight(liveAsst, width)}`,
  );
  const tools: RenderBlock = {
    kind: "toolGroup",
    id: "g",
    group: "explore",
    items: [
      {
        kind: "tool",
        id: "t1",
        tool: "read",
        target: "a",
        status: "ok",
      },
      {
        kind: "tool",
        id: "t2",
        tool: "grep",
        target: "x",
        status: "ok",
      },
    ],
  };
  assert(
    "tool group height is header + rows",
    measureBlockHeight(tools, width) === 3,
    `h=${measureBlockHeight(tools, width)}`,
  );

  const failed = checks.filter((c) => !c.ok);
  for (const check of checks) {
    const mark = check.ok ? "ok" : "FAIL";
    const extra = check.detail ? ` — ${check.detail}` : "";
    console.log(`[${mark}] ${check.name}${extra}`);
  }
  console.log(
    `\n${checks.length - failed.length}/${checks.length} passed` +
      (failed.length ? ` (${failed.length} failed)` : ""),
  );
  process.exit(failed.length ? 1 : 0);
}

main();
