/**
 * ui/scroll — line-based transcript windowing (pi-style).
 *
 * Pure helpers, no React. Heights are content-only; Activity border rules are
 * reserved in the app's viewport budget, not added here.
 */

import type { ActivityItem, RenderBlock } from "./state.js";

/** Character-wrap line count (matches Ink Text wrap≈ceil for monospace). */
function wrappedLineCount(text: string, width: number): number {
  const w = Math.max(20, width);
  const lines = text.split(/\r?\n/);
  let wrapped = 0;
  for (const line of lines) {
    wrapped += Math.max(1, Math.ceil(Math.max(1, line.length) / w));
  }
  return Math.max(1, wrapped);
}

function isToolish(block: RenderBlock): boolean {
  return (
    block.kind === "toolGroup" ||
    (block.kind === "single" && block.item.kind === "tool")
  );
}

/** Row count for one block (no inter-block gap). */
export function measureBlockHeight(
  block: RenderBlock,
  contentWidth: number,
): number {
  if (block.kind === "toolGroup") {
    // header + tool rows (no marginBottom)
    return block.items.length + 1;
  }

  const item: ActivityItem = block.item;
  const w = Math.max(20, contentWidth - 2);

  switch (item.kind) {
    case "plan":
      return item.steps.length + 2;
    case "approval":
      return 4;
    case "verify":
      return item.logPath ? 3 : 2;
    case "assistant": {
      const wrapped = wrappedLineCount(item.text, w);
      // Streaming caps shown body lines at 18 (Grok-style tail).
      const shown = item.done ? wrapped : Math.min(18, wrapped);
      // Optional dim "streaming" status only while in flight; no done badge.
      const status = item.done ? 0 : 1;
      return status + Math.max(1, shown);
    }
    case "thinking": {
      const lines = item.text.split(/\r?\n/);
      const raw = Math.max(1, lines.length);
      // Fold caps: streaming ≤8, sealed ≤4.
      const shown = item.done ? Math.min(4, raw) : Math.min(8, raw);
      // header + body (no marginBottom)
      return 1 + shown;
    }
    case "user": {
      // body lines only (no marginBottom)
      return wrappedLineCount(item.text, w);
    }
    case "tool":
      return 1;
    case "note":
      return 1;
    default:
      return 1;
  }
}

/**
 * Per-block heights including gapBefore (+1 before every non-first block that
 * is not tool-after-tool), matching Activity's marginTop spacing.
 */
export function measureHeights(
  blocks: RenderBlock[],
  contentWidth: number,
): number[] {
  return blocks.map((block, i) => {
    let h = measureBlockHeight(block, contentWidth);
    if (i > 0) {
      const prev = blocks[i - 1]!;
      if (!(isToolish(prev) && isToolish(block))) {
        h += 1;
      }
    }
    return h;
  });
}

export type LineWindow = {
  visible: RenderBlock[];
  /** Lines to skip at the start of the first visible block (mid-message clip). */
  clipTop: number;
  maxScroll: number;
  atBottom: boolean;
  canScrollUp: boolean;
  hiddenAboveLines: number;
  hiddenBelowLines: number;
  totalLines: number;
};

/**
 * Pi-style line window: scrollFromBottom === 0 follows the live edge.
 * totalLines is sum(heights) only — borders stay in the app budget.
 */
export function windowByLines(
  blocks: RenderBlock[],
  heights: number[],
  viewportRows: number,
  scrollFromBottom: number,
): LineWindow {
  const totalLines = heights.reduce((a, b) => a + b, 0);
  const vp = Math.max(1, viewportRows);
  const maxScroll = Math.max(0, totalLines - vp);

  if (blocks.length === 0 || totalLines === 0) {
    return {
      visible: [],
      clipTop: 0,
      maxScroll: 0,
      atBottom: true,
      canScrollUp: false,
      hiddenAboveLines: 0,
      hiddenBelowLines: 0,
      totalLines: 0,
    };
  }

  const scroll = Math.max(0, Math.min(scrollFromBottom, maxScroll));
  const endLine = totalLines - scroll; // exclusive
  const startLine = Math.max(0, endLine - vp);

  // Cumulative start offsets per block.
  const offsets: number[] = [];
  let cursor = 0;
  for (let i = 0; i < heights.length; i += 1) {
    offsets.push(cursor);
    cursor += heights[i]!;
  }

  const visible: RenderBlock[] = [];
  let firstIdx = -1;
  let lastIdx = -1;

  for (let i = 0; i < blocks.length; i += 1) {
    const blockStart = offsets[i]!;
    const blockEnd = blockStart + heights[i]!;
    // Intersects [startLine, endLine)
    if (blockEnd > startLine && blockStart < endLine) {
      if (firstIdx < 0) firstIdx = i;
      lastIdx = i;
      visible.push(blocks[i]!);
    }
  }

  const firstBlockStart = firstIdx >= 0 ? offsets[firstIdx]! : 0;
  const clipTop =
    firstIdx >= 0 && startLine > firstBlockStart
      ? startLine - firstBlockStart
      : 0;

  const hiddenAboveLines = startLine;
  const hiddenBelowLines = Math.max(0, totalLines - endLine);

  return {
    visible,
    clipTop,
    maxScroll,
    atBottom: scroll <= 0,
    canScrollUp: scroll > 0 || startLine > 0,
    hiddenAboveLines,
    hiddenBelowLines,
    totalLines,
  };
}
