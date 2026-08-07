/**
 * ui/components — presentational pieces of the CLAI shell.
 *
 * Metallic silver on matte black. Every colour goes through `resolve(token)`;
 * every lifecycle icon through `lifecycleIcon` / `LIFECYCLE`. Saturated colour
 * is reserved for the verification state machine.
 */

import React from "react";
import { Box, Text, type DOMElement } from "ink";
import type { PlanStep } from "./events.js";
import type {
  ActivityItem,
  ApprovalItem,
  AssistantItem,
  NoteItem,
  PlanItem,
  RenderBlock,
  RunContext,
  RunMetrics,
  ToolItem,
  UserItem,
  VerifyItem,
} from "./state.js";
import {
  CREDIT,
  LIFECYCLE,
  WORDMARK,
  WORDMARK_LARGE,
  WORDMARK_LARGE_COLS,
  faintUsesDim,
  glyph,
  glyphs,
  lifecycleIcon,
  resolve,
  type LifecycleState,
  type ThemeToken,
} from "./theme.js";

// ── formatting helpers ───────────────────────────────────────────────────────

/** `28221` → `28,221` (en-US thousands). */
export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDuration(ms?: number): string | undefined {
  if (ms == null) return undefined;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

/** Always two decimals with a leading `$` — `$0.00 spent`, never `$0`. */
export function formatCost(usd?: number): string {
  return `$${(usd ?? 0).toFixed(2)}`;
}

/**
 * Cost for log lines / small API runs — keeps sub-cent amounts visible
 * (e.g. $0.0003 instead of rounding to `$0.00`).
 */
export function formatCostPrecise(usd?: number): string {
  const n = usd ?? 0;
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  if (n >= 0.0001) return `$${n.toFixed(4)}`;
  if (n >= 0.000001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(2)}`;
}

/** One-line ellipsis so a long command never reflows the log. */
export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1))}…`;
}

/** Simple greedy word wrap for block-line content. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.length <= width) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line.length === 0) {
        line = word;
      } else if (line.length + 1 + word.length <= width) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
      while (line.length > width) {
        lines.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

// ── low-level paint helpers ──────────────────────────────────────────────────

export type Segment = { text: string; color?: string; bold?: boolean; dim?: boolean };

function segmentsLength(segments: Segment[]): number {
  return segments.reduce((n, s) => n + s.text.length, 0);
}

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <Text
          key={index}
          color={segment.color}
          bold={segment.bold}
          dimColor={segment.dim}
        >
          {segment.text}
        </Text>
      ))}
    </>
  );
}

/**
 * Quiet content row (no per-row chrome). Prefer this over bordered sub-elements.
 */
export function BlockLine({
  width,
  ruleColor: _ruleColor,
  segments,
  background: _background,
}: {
  width: number;
  ruleColor?: string;
  segments: Segment[];
  background?: string;
}) {
  const pad = Math.max(0, width - segmentsLength(segments));
  return (
    <Text>
      <Segments segments={segments} />
      <Text>{" ".repeat(pad)}</Text>
    </Text>
  );
}

// ── brand ────────────────────────────────────────────────────────────────────

/** Single quiet wordmark line — bright metallic silver, bold. No ASCII art. */
export function Wordmark() {
  return (
    <Text bold color={resolve("brand.wordmark")}>
      {WORDMARK}
    </Text>
  );
}

/** Barely-there credit for the strip's far right. */
export function Credit() {
  return (
    <Text color={resolve("text.muted")} dimColor={faintUsesDim()}>
      {CREDIT}
    </Text>
  );
}

/**
 * Startup brand motion: large half-block CLAI, letter reveal + metallic shimmer.
 * Theme tokens only — no neon, no boxed splash chrome.
 */
export const BRAND_INTRO_INTERVAL_MS = 85;
/** Reveal (5) + hold (3) + shimmer (12) + settle (6) ≈ 2.2s. */
export const BRAND_INTRO_TOTAL_TICKS = 26;

export function brandIntroLetterColor(
  index: number,
  tick: number,
): string | undefined {
  const lettersShown = Math.min(
    WORDMARK.length,
    Math.max(0, tick <= 4 ? tick : WORDMARK.length),
  );
  if (index >= lettersShown) return undefined;

  // Shimmer window: ticks 8..19 sweep a bright highlight across letters.
  if (tick >= 8 && tick <= 19) {
    const highlight = (tick - 8) % WORDMARK.length;
    if (index === highlight) return resolve("brand.wordmark");
    if (index === (highlight + WORDMARK.length - 1) % WORDMARK.length) {
      return resolve("text.primary");
    }
    return resolve("text.muted");
  }

  // Settle: full bright wordmark.
  if (tick >= 20) return resolve("brand.wordmark");

  // Reveal: newly typed letter bright, prior letters primary steel.
  if (index === lettersShown - 1) return resolve("brand.wordmark");
  return resolve("text.primary");
}

function largeLetterColor(letterIndex: number, tick: number): string | undefined {
  return brandIntroLetterColor(letterIndex, tick);
}

export function BrandIntro({
  tick,
  width,
}: {
  tick: number;
  width: number;
}) {
  const lettersShown = Math.min(
    WORDMARK.length,
    Math.max(0, tick <= 4 ? tick : WORDMARK.length),
  );
  const showCredit = tick >= 6;
  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width={width}
    >
      <Box flexDirection="column">
        {WORDMARK_LARGE.map((row, rowIndex) => (
          <Text key={rowIndex} bold>
            {[...row].map((char, col) => {
              const letterIndex = WORDMARK_LARGE_COLS.findIndex(
                ([start, end]) => col >= start && col < end,
              );
              if (letterIndex < 0 || letterIndex >= lettersShown) {
                return (
                  <Text key={col} color={resolve("text.muted")}>
                    {" "}
                  </Text>
                );
              }
              const color = largeLetterColor(letterIndex, tick);
              return (
                <Text key={col} color={color}>
                  {char === " " ? " " : char}
                </Text>
              );
            })}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text bold color={resolve("brand.wordmark")}>
          {WORDMARK.slice(0, lettersShown)}
        </Text>
      </Box>
      {showCredit ? (
        <Box marginTop={1}>
          <Credit />
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text> </Text>
        </Box>
      )}
    </Box>
  );
}

/** True when we should play the launch animation (real interactive TTY only). */
export function shouldPlayBrandIntro(opts: {
  interactive?: boolean;
  stdout?: { isTTY?: boolean } | null;
  env?: Record<string, string | undefined>;
}): boolean {
  const env = opts.env ?? process.env;
  if (env.CLAI_NO_INTRO === "1") return false;
  if (env.NO_COLOR) return false;
  if (!opts.interactive) return false;
  // Fake streams used by render-check are TTY-flagged but are not process.stdout.
  if (!opts.stdout || opts.stdout !== process.stdout) return false;
  return Boolean(opts.stdout.isTTY);
}

// ── session stats (top-right) ────────────────────────────────────────────────

export type SessionStats = {
  elapsedMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd?: number;
  toolCalls: number;
  /** True while a turn is still in flight. */
  live?: boolean;
};

/** Compact top-right panel: time · tokens · cost · tool calls (live-updating). */
export function StatsPanel({
  stats,
  width = 28,
}: {
  stats: SessionStats;
  width?: number;
}) {
  const totalTokens = stats.tokensIn + stats.tokensOut;
  const timeLabel =
    formatDuration(stats.elapsedMs) ?? (stats.elapsedMs > 0 ? "0ms" : "—");
  const rows = [
    { k: "time", v: timeLabel },
    { k: "tokens", v: formatTokens(totalTokens) },
    {
      k: "  in/out",
      v: `${formatTokens(stats.tokensIn)}/${formatTokens(stats.tokensOut)}`,
    },
    { k: "cost", v: formatCostPrecise(stats.costUsd) },
    { k: "tools", v: String(stats.toolCalls) },
  ];
  const inner = Math.max(18, width - 2);
  return (
    <Box flexDirection="column" width={width}>
      <Box>
        <Text color={resolve("text.muted")}>session</Text>
        {stats.live ? (
          <Text color={resolve("state.working")}> · live</Text>
        ) : null}
      </Box>
      <Text color={resolve("border")}>{glyph("hRule").repeat(inner)}</Text>
      {rows.map((row) => (
        <Box key={row.k} justifyContent="space-between" width={inner}>
          <Text color={resolve("text.muted")}>{row.k}</Text>
          <Text bold={row.k === "tokens" || row.k === "cost"} color={resolve("text.primary")}>
            {row.v}
          </Text>
        </Box>
      ))}
      <Text color={resolve("border")}>{glyph("hRule").repeat(inner)}</Text>
    </Box>
  );
}

// ── scroll affordances ───────────────────────────────────────────────────────

export function ScrollCue({
  direction,
  label,
  register,
}: {
  direction: "up" | "down";
  label: string;
  register?: (node: DOMElement | null) => void;
}) {
  const arrow = direction === "up" ? "↑" : "↓";
  return (
    <Box ref={(node) => register?.(node as DOMElement | null)}>
      <Text bold color={resolve("brand.wordmark")}>
        {arrow}{" "}
      </Text>
      <Text color={resolve("text.muted")}>{label}</Text>
      <Text color={resolve("text.muted")}>  </Text>
      <Text color={resolve("state.verify")}>[expand]</Text>
    </Box>
  );
}

// ── live code fragment ───────────────────────────────────────────────────────

/** Pull a short live fragment from assistant text (fenced code or code-like lines). */
export function extractCodeFragment(text: string): string | null {
  const fence = /```[\w+-]*\r?\n?([\s\S]*?)(?:```|$)/.exec(text);
  if (fence?.[1]) {
    const lines = fence[1].replace(/\s+$/, "").split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return null;
    return lines.slice(-5).join("\n");
  }

  const lines = text.split(/\r?\n/);
  const codey = lines.filter((line) =>
    /[{};=>]|^\s{2,}|^(import|export|const|let|var|function|class|def|return)\b/.test(
      line,
    ),
  );
  if (codey.length < 2) return null;
  return codey.slice(-5).join("\n");
}

/**
 * Short typewriter panel shown while the assistant is still streaming code.
 * Reveals the live fragment character-by-character with a metallic caret.
 */
export function CodeWriteFragment({
  text,
  frame,
  width,
}: {
  text: string;
  frame: number;
  width: number;
}) {
  const fragment = extractCodeFragment(text);
  if (!fragment) return null;

  // Pace the reveal a few chars behind the live tip so writing is visible.
  const target = Math.max(0, fragment.length - 1);
  const reveal = Math.min(fragment.length, Math.max(1, target - (frame % 3 === 0 ? 0 : 1)));
  // Grow reveal with length; animate last ~24 chars via frame.
  const trail = 24;
  const base = Math.max(0, fragment.length - trail);
  const animated = base + Math.min(trail, Math.floor((frame % (trail + 1))));
  const cut = Math.min(fragment.length, Math.max(reveal, animated, fragment.length > trail ? fragment.length - 2 : fragment.length));
  const shown = fragment.slice(0, cut);
  const lines = shown.split("\n");
  const inner = Math.max(12, width - 4);
  const caret = glyphs().spinnerFrames[frame % glyphs().spinnerFrames.length]!;

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0} paddingLeft={1}>
      <Text color={resolve("text.muted")}>writing</Text>
      <Text color={resolve("border")}>{glyph("hRule").repeat(Math.min(inner, 36))}</Text>
      {lines.map((line, index) => (
        <Text key={index} color={resolve("text.primary")}>
          {`  ${truncate(line, inner - 2)}`}
          {index === lines.length - 1 ? (
            <Text color={resolve("state.verify")}>{` ${caret}`}</Text>
          ) : null}
        </Text>
      ))}
      <Text color={resolve("border")}>{glyph("hRule").repeat(Math.min(inner, 36))}</Text>
    </Box>
  );
}

// ── lifecycle widget ─────────────────────────────────────────────────────────

export type LifecyclePhase = {
  state: LifecycleState;
  detail?: string;
};

/** Derive the live verification phase from reduced UI state (render-only). */
export function deriveLifecycle(args: {
  status: { label: string; detail?: string; level: string } | null;
  items: ActivityItem[];
}): LifecyclePhase | null {
  const pendingApproval = args.items.find(
    (item): item is ApprovalItem =>
      item.kind === "approval" && item.decision == null,
  );
  if (pendingApproval) {
    return {
      state: "blocked",
      detail: truncate(pendingApproval.request, 48),
    };
  }

  if (args.status) {
    const label = args.status.label.toLowerCase();
    const detail = args.status.detail;
    if (/\brepair\b/.test(label) || args.status.level === "warn") {
      return { state: "repair", detail: detail ?? args.status.label };
    }
    if (/\bverif/.test(label)) {
      return { state: "verify", detail: detail ?? args.status.label };
    }
    if (args.status.level === "error") {
      return { state: "fail", detail: detail ?? args.status.label };
    }
    return { state: "working", detail: detail ?? args.status.label };
  }

  for (let i = args.items.length - 1; i >= 0; i -= 1) {
    const item = args.items[i]!;
    if (item.kind === "verify") {
      return {
        state: item.ok ? "pass" : "fail",
        detail: item.detail ?? item.label,
      };
    }
  }

  return null;
}

/**
 * Persistent single-line lifecycle widget. Exactly one icon + one colour.
 * Braille spinner during Working / Verify / Repair.
 * Detail is omitted when it would just repeat the state name (no grey twin).
 */
export function LifecycleLine({
  phase,
  frame,
  width,
}: {
  phase: LifecyclePhase | null;
  frame: number;
  width: number;
}) {
  if (!phase) return null;
  const spec = LIFECYCLE[phase.state];
  const color = resolve(spec.token);
  const spinning =
    phase.state === "working" ||
    phase.state === "verify" ||
    phase.state === "repair";
  const frames = glyphs().spinnerFrames;
  const icon = spinning
    ? frames[frame % frames.length]!
    : lifecycleIcon(phase.state);

  const rawDetail = phase.detail?.trim() ?? "";
  const detail =
    !rawDetail ||
    rawDetail.toLowerCase() === spec.label.toLowerCase() ||
    rawDetail.toLowerCase() === phase.state
      ? undefined
      : rawDetail;

  const labelBudget = Math.max(8, width - spec.label.length - 4);
  return (
    <Box>
      <Text color={color}>{icon} </Text>
      <Text bold color={color}>
        {spec.label}
      </Text>
      {detail ? (
        <Text color={resolve("text.muted")}>
          {`  ${truncate(detail, labelBudget)}`}
        </Text>
      ) : null}
    </Box>
  );
}

// ── prompt box ───────────────────────────────────────────────────────────────

export function PromptBox({
  width,
  value,
  placeholder,
  focused,
  agent,
  model,
  provider,
  showCaret,
}: {
  width: number;
  value: string;
  placeholder: string;
  focused: boolean;
  agent: string;
  model?: string;
  provider?: string;
  showCaret: boolean;
}) {
  const ruleColor = focused ? resolve("brand.wordmark") : resolve("border");
  const inner = Math.max(8, width - 2);

  const inputSegments: Segment[] = value
    ? [
        { text: truncate(value, showCaret ? inner - 1 : inner), color: resolve("text.primary") },
        ...(showCaret ? [{ text: "▏", color: resolve("text.muted") }] : []),
      ]
    : [{ text: truncate(placeholder, inner), color: resolve("text.muted") }];

  const modelSegments: Segment[] = [
    { text: agent, color: resolve("text.primary"), bold: true },
  ];
  if (model) {
    modelSegments.push({ text: "  " }, { text: model, color: resolve("text.primary") });
  }
  if (provider) {
    modelSegments.push({ text: "  " }, { text: provider, color: resolve("text.muted") });
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text>
        <Text color={ruleColor}>{glyph("leftRule")} </Text>
        <Segments segments={inputSegments} />
      </Text>
      <Text>
        <Text color={ruleColor}>{glyph("leftRule")} </Text>
        <Segments segments={modelSegments} />
      </Text>
    </Box>
  );
}

/** Right-aligned keybind hint line: `tab switch agent  ctrl+p commands`. */
export function HintLine({
  width,
  hints,
}: {
  width: number;
  hints: Array<{ key: string; label: string }>;
}) {
  const plain = hints.map((h) => `${h.key} ${h.label}`).join("  ");
  const pad = Math.max(0, width - plain.length);
  return (
    <Text>
      {" ".repeat(pad)}
      {hints.map((hint, index) => (
        <Text key={hint.key}>
          {index > 0 ? "  " : ""}
          <Text bold color={resolve("text.primary")}>
            {hint.key}
          </Text>
          <Text color={resolve("text.muted")}>{` ${hint.label}`}</Text>
        </Text>
      ))}
    </Text>
  );
}

// ── conversation blocks ──────────────────────────────────────────────────────

export function UserBlock({ item, width }: { item: UserItem; width: number }) {
  const lines = wrapText(item.text, Math.max(8, width - 2));
  return (
    <Box flexDirection="column" marginBottom={1}>
      {lines.map((line, index) => (
        <Text key={index} color={resolve("text.primary")}>
          {index === 0 ? `› ${line}` : `  ${line}`}
        </Text>
      ))}
    </Box>
  );
}

export function AssistantProse({
  item,
  width,
  spinnerFrame = 0,
}: {
  item: AssistantItem;
  width?: number;
  spinnerFrame?: number;
}) {
  const STREAM_TAIL = 18;
  const allLines = item.text.replace(/\s+$/, "").split(/\r?\n/);
  const truncated = !item.done && allLines.length > STREAM_TAIL;
  const display = truncated
    ? allLines.slice(-STREAM_TAIL).join("\n")
    : item.text.trimEnd();
  const showCode = !item.done && width != null;
  const caret = glyphs().spinnerFrames[spinnerFrame % glyphs().spinnerFrames.length]!;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        {!item.done ? (
          <Text color={resolve("state.verify")}>streaming </Text>
        ) : (
          <Text color={resolve("state.pass")}>processed </Text>
        )}
        <Text color={resolve("text.muted")}>
          {item.done ? "· reply" : "· live"}
        </Text>
      </Box>
      {truncated ? (
        <Text color={resolve("text.muted")}>… </Text>
      ) : null}
      <Text wrap="wrap" color={resolve("text.primary")}>
        {display}
        {!item.done ? (
          <Text color={resolve("state.verify")}>{` ${caret}`}</Text>
        ) : null}
      </Text>
      {showCode ? (
        <CodeWriteFragment
          text={item.text}
          frame={spinnerFrame}
          width={width}
        />
      ) : null}
    </Box>
  );
}

// ── tool rows ────────────────────────────────────────────────────────────────

/** Tools share the lifecycle icon set — ● in flight, ✓ ok, ✗ fail. */
export function toolSigil(tool: string): string {
  void tool;
  return lifecycleIcon("working");
}

function toolVerb(tool: string): string {
  if (!tool) return "Tool";
  return tool.charAt(0).toUpperCase() + tool.slice(1);
}

export function ToolRowLine({
  item,
  width,
  spinnerFrame,
  expanded,
  indent = 0,
  registerRow,
}: {
  item: ToolItem;
  width: number;
  spinnerFrame: number;
  expanded?: boolean;
  indent?: number;
  registerRow?: (id: string, node: DOMElement | null) => void;
}) {
  const rowRef = (node: DOMElement | null) => registerRow?.(item.id, node);
  const verb = toolVerb(item.tool);
  const target = item.target ?? "";
  const budget = Math.max(12, width - indent - verb.length - 12);
  const frames = glyphs().spinnerFrames;

  if (item.status === "pending") {
    return (
      <Box paddingLeft={indent} ref={rowRef}>
        <Text color={resolve("state.working")}>
          {frames[spinnerFrame % frames.length]}{" "}
        </Text>
        <Text bold color={resolve("text.primary")}>
          {verb}
        </Text>
        {target ? (
          <Text color={resolve("text.muted")}>{` ${truncate(target, budget)}`}</Text>
        ) : null}
      </Box>
    );
  }

  if (item.status === "fail") {
    return (
      <Box flexDirection="column" paddingLeft={indent} ref={rowRef}>
        <Box>
          <Text color={resolve("state.fail")}>{lifecycleIcon("fail")} </Text>
          <Text bold color={resolve("text.primary")}>
            {verb}
          </Text>
          {target ? (
            <Text color={resolve("text.muted")}>{` ${truncate(target, budget)}`}</Text>
          ) : null}
          <Text color={resolve("state.fail")}> Failed</Text>
        </Box>
        {item.detail ? (
          <Box flexDirection="column" marginLeft={2}>
            {wrapText(item.detail, Math.max(8, width - indent - 4)).map((line, i) => (
              <Text key={i} color={resolve("text.muted")}>
                {line}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
    );
  }

  const duration = formatDuration(item.durationMs);
  const detail = item.detail && item.detail !== item.target ? item.detail : undefined;
  return (
    <Box flexDirection="column" paddingLeft={indent} ref={rowRef}>
      <Box>
        <Text color={resolve("state.pass")}>{lifecycleIcon("pass")} </Text>
        <Text bold color={resolve("text.primary")}>
          {verb}
        </Text>
        {target ? (
          <Text color={resolve("text.muted")}>{` ${truncate(target, budget)}`}</Text>
        ) : null}
        {duration ? (
          <Text color={resolve("text.muted")}>{`  ${duration}`}</Text>
        ) : null}
      </Box>
      {expanded && detail ? (
        <Box flexDirection="column" marginLeft={2}>
          {wrapText(detail, Math.max(8, width - indent - 4)).map((line, i) => (
            <Text key={i} color={resolve("text.muted")}>
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

/** A run of grouped tool rows: `explore 2/2` header, tight children. */
export function ToolGroupBlock({
  group,
  items,
  width,
  spinnerFrame,
  expandedIds,
  registerRow,
}: {
  group: string;
  items: ToolItem[];
  width: number;
  spinnerFrame: number;
  expandedIds?: ReadonlySet<string>;
  registerRow?: (id: string, node: DOMElement | null) => void;
}) {
  const done = items.filter((item) => item.status !== "pending").length;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={resolve("text.primary")}>{group}</Text>
        <Text color={resolve("text.muted")}>{` ${done}/${items.length}`}</Text>
      </Box>
      {items.map((item) => (
        <ToolRowLine
          key={item.id}
          item={item}
          width={width}
          spinnerFrame={spinnerFrame}
          expanded={expandedIds?.has(item.id)}
          registerRow={registerRow}
        />
      ))}
    </Box>
  );
}

// ── todo / plan block ────────────────────────────────────────────────────────

function planStepVisual(
  state: PlanStep["state"],
): { icon: string; color?: string; textColor?: string } {
  switch (state) {
    case "done":
      return {
        icon: lifecycleIcon("pass"),
        color: resolve("state.pass"),
        textColor: resolve("text.muted"),
      };
    case "active":
      return {
        icon: lifecycleIcon("working"),
        color: resolve("state.working"),
        textColor: resolve("text.primary"),
      };
    case "failed":
      return {
        icon: lifecycleIcon("fail"),
        color: resolve("state.fail"),
        textColor: resolve("text.primary"),
      };
    case "skipped":
      return {
        icon: lifecycleIcon("blocked"),
        color: resolve("state.blocked"),
        textColor: resolve("text.muted"),
      };
    default:
      return {
        icon: lifecycleIcon("working"),
        color: resolve("text.muted"),
        textColor: resolve("text.muted"),
      };
  }
}

export function PlanBlock({ item, width }: { item: PlanItem; width: number }) {
  const measure = Math.max(8, width - 4);
  return (
    <Box flexDirection="column" marginBottom={1}>
      {item.title ? (
        <Text bold color={resolve("text.primary")}>
          {item.title}
        </Text>
      ) : null}
      {item.steps.map((step, index) => {
        const { icon, color, textColor } = planStepVisual(step.state);
        const lines = wrapText(step.label, measure);
        return (
          <Box key={step.id ?? `${item.id}-${index}`} flexDirection="column">
            {lines.map((line, lineIndex) => (
              <Box key={lineIndex}>
                {lineIndex === 0 ? (
                  <>
                    <Text color={color}>{icon} </Text>
                    <Text color={textColor}>{line}</Text>
                  </>
                ) : (
                  <Text color={textColor}>{`  ${line}`}</Text>
                )}
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

// ── approval / verify / note ─────────────────────────────────────────────────

export function ApprovalPrompt({ item, width }: { item: ApprovalItem; width: number }) {
  const decided = item.decision != null;
  const colorToken: ThemeToken =
    item.decision === "denied"
      ? "state.fail"
      : item.decision === "allowed" || item.decision === "auto"
        ? "state.pass"
        : "state.working";
  const icon = decided
    ? item.decision === "denied"
      ? lifecycleIcon("fail")
      : lifecycleIcon("pass")
    : glyph("warn");
  const lines = wrapText(item.request, Math.max(8, width - 4));
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
      <Box>
        <Text color={resolve(colorToken)}>{icon} </Text>
        <Text bold color={resolve("text.primary")}>
          approval
        </Text>
        <Text color={resolve("text.muted")}>{`  ${item.tool}`}</Text>
      </Box>
      {lines.map((line, index) => (
        <Text key={index} color={resolve("text.muted")}>
          {`  ${line}`}
        </Text>
      ))}
      <Text color={resolve(colorToken)}>
        {`  ${
          decided
            ? `${item.decision}${item.reason ? ` · ${item.reason}` : ""}`
            : "waiting · y allow / n deny"
        }`}
      </Text>
    </Box>
  );
}

export function VerifyResult({ item, width }: { item: VerifyItem; width: number }) {
  const state: LifecycleState = item.ok ? "pass" : "fail";
  const color = resolve(LIFECYCLE[state].token);
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
      <Box>
        <Text color={color}>{lifecycleIcon(state)} </Text>
        <Text bold color={color}>
          {LIFECYCLE[state].label}
        </Text>
        <Text color={resolve("text.muted")}>{`  ${item.label}`}</Text>
        {item.detail ? (
          <Text color={resolve("text.muted")}>
            {`  ${truncate(item.detail, Math.max(12, width - 30))}`}
          </Text>
        ) : null}
      </Box>
      {item.logPath ? (
        <Box paddingLeft={2}>
          <Text color={resolve("text.muted")} dimColor={faintUsesDim()}>
            {item.logPath}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function NoteRow({ item, width }: { item: NoteItem; width: number }) {
  const token: ThemeToken =
    item.level === "error"
      ? "state.fail"
      : item.level === "warn"
        ? "state.working"
        : "text.muted";
  const icon =
    item.level === "error"
      ? lifecycleIcon("fail")
      : item.level === "warn"
        ? glyph("warn")
        : lifecycleIcon("working");
  return (
    <Box>
      <Text color={resolve(token)}>{`${icon} ${item.label}`}</Text>
      {item.detail ? (
        <Text color={resolve("text.muted")}>
          {`  ${truncate(item.detail, Math.max(12, width - item.label.length - 6))}`}
        </Text>
      ) : null}
    </Box>
  );
}

// ── in-flight line (compat wrapper around LifecycleLine) ─────────────────────

export function WorkingLine({
  status,
  agent,
  model,
  frame,
  width,
}: {
  status: { label: string; detail?: string; level: string } | null;
  agent: string;
  model?: string;
  frame: number;
  width: number;
}) {
  if (!status) return null;
  const phase = deriveLifecycle({ status, items: [] });
  const detail = [
    agent,
    model,
    status.label,
    status.detail,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <LifecycleLine
      phase={phase ? { ...phase, detail } : null}
      frame={frame}
      width={width}
    />
  );
}

// ── plan / approvals panes ───────────────────────────────────────────────────

/** @deprecated Prefer PlanPane; kept for export stability. */
export const SIDEBAR_WIDTH = 36;

export function PlanPane({
  todo,
  width,
}: {
  todo: PlanItem | null;
  width: number;
}) {
  if (!todo || todo.steps.length === 0) return null;
  return (
    <Box flexDirection="column" width={width} marginTop={1}>
      <Text color={resolve("text.muted")}>plan</Text>
      <PlanBlock item={todo} width={width} />
    </Box>
  );
}

export function ApprovalsPane({
  items,
  width,
}: {
  items: ApprovalItem[];
  width: number;
}) {
  const pending = items.filter((item) => item.decision == null);
  if (pending.length === 0) return null;
  return (
    <Box flexDirection="column" width={width} marginTop={1}>
      <Text color={resolve("text.muted")}>approvals</Text>
      {pending.map((item) => (
        <ApprovalPrompt key={item.id} item={item} width={width} />
      ))}
    </Box>
  );
}

/**
 * Compact side column used when the terminal is wide enough. Shows plan only —
 * MCP / LSP / tokens live on the context strip.
 */
export function Sidebar({
  context: _context,
  metrics: _metrics,
  todo,
  height: _height,
  version: _version,
}: {
  context: RunContext;
  metrics: RunMetrics;
  todo: PlanItem | null;
  height: number;
  version: string;
}) {
  return (
    <Box flexDirection="column" width={SIDEBAR_WIDTH} paddingLeft={2}>
      <PlanPane todo={todo} width={SIDEBAR_WIDTH - 2} />
    </Box>
  );
}

// ── context strip ────────────────────────────────────────────────────────────

export type FooterHint = { id: string; key: string; label: string };

/**
 * @deprecated Progress fills removed from the design language. Renders a quiet
 * muted rule so existing call sites keep compiling.
 */
export function ProgressBar({ fraction }: { fraction: number }) {
  void fraction;
  return <Text color={resolve("border")}>{glyph("hRule").repeat(8)}</Text>;
}

/** Slim demoted strip: model · provider · sandbox · tokens/cost · credit. */
export function ContextStrip({
  width,
  context,
  metrics,
  lifecycle,
  hints,
  interrupt,
  registerHint,
}: {
  width: number;
  context: RunContext;
  metrics: RunMetrics;
  lifecycle: LifecyclePhase | null;
  hints?: FooterHint[];
  interrupt?: "armed" | "confirm" | null;
  registerHint?: (id: string, node: DOMElement | null) => void;
}) {
  const { model, provider } = splitModel(context.model);
  const narrow = width < 100;
  const totalTokens = metrics.tokensIn + metrics.tokensOut;
  const parts: string[] = [];

  if (model) parts.push(model);
  if (!narrow && provider) parts.push(provider);
  if (!narrow && context.sandboxMode) parts.push(context.sandboxMode);

  if (narrow) {
    if (lifecycle && (lifecycle.state === "pass" || lifecycle.state === "fail")) {
      parts.push(LIFECYCLE[lifecycle.state].label);
    }
  } else {
    if (totalTokens > 0) {
      parts.push(`${formatTokens(totalTokens)} tok`);
    }
    if (metrics.costUsd != null) {
      parts.push(formatCost(metrics.costUsd));
    }
    if (context.tracePath) {
      parts.push(truncate(context.tracePath, 28));
    }
  }

  const left = parts.join(" · ");

  return (
    <Box width={width} flexDirection="row" justifyContent="space-between">
      <Box>
        <Text color={resolve("text.muted")}>{left}</Text>
        {interrupt != null ? (
          <Box
            marginLeft={left ? 2 : 0}
            ref={(node) => registerHint?.("interrupt", node as DOMElement | null)}
          >
            <Text
              bold
              color={
                interrupt === "confirm"
                  ? resolve("state.working")
                  : resolve("text.primary")
              }
            >
              esc
            </Text>
            <Text color={resolve("text.muted")}>
              {interrupt === "confirm" ? " again to interrupt" : " interrupt"}
            </Text>
          </Box>
        ) : null}
        {hints?.map((hint) =>
          hint.id === "interrupt" ? null : (
            <Box
              key={hint.id}
              marginLeft={2}
              ref={(node) => registerHint?.(hint.id, node as DOMElement | null)}
            >
              <Text bold color={resolve("text.primary")}>
                {hint.key}
              </Text>
              <Text color={resolve("text.muted")}>{` ${hint.label}`}</Text>
            </Box>
          ),
        )}
      </Box>
      <Credit />
    </Box>
  );
}

/** FooterBar — thin wrapper so existing app code keeps a familiar name. */
export function FooterBar({
  width,
  left: _left,
  progress: _progress,
  interrupt,
  hints,
  registerHint,
  context,
  metrics,
  lifecycle,
}: {
  width: number;
  left?: string;
  progress?: number;
  interrupt: "armed" | "confirm" | null;
  hints: FooterHint[];
  registerHint?: (id: string, node: DOMElement | null) => void;
  context?: RunContext;
  metrics?: RunMetrics;
  lifecycle?: LifecyclePhase | null;
}) {
  return (
    <ContextStrip
      width={width}
      context={context ?? { mcp: [], lsp: [] }}
      metrics={metrics ?? { tokensIn: 0, tokensOut: 0 }}
      lifecycle={lifecycle ?? null}
      hints={hints}
      interrupt={interrupt}
      registerHint={registerHint}
    />
  );
}

/** @deprecated Splash removed — credit + cwd live on the context strip. */
export function SplashFooter({
  width,
  cwd,
  mcpCount: _mcpCount,
  version: _version,
}: {
  width: number;
  cwd?: string;
  mcpCount: number;
  version: string;
}) {
  return (
    <Box width={width} flexDirection="row" justifyContent="space-between">
      <Text color={resolve("text.muted")}>{cwd ?? ""}</Text>
      <Credit />
    </Box>
  );
}

function splitModel(raw?: string): { model?: string; provider?: string } {
  if (!raw) return {};
  const slash = raw.indexOf("/");
  if (slash <= 0) return { model: raw };
  return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) };
}

// ── activity dispatch ────────────────────────────────────────────────────────

export function ActivityRowFor({
  item,
  width,
  spinnerFrame,
  expandedIds,
  registerRow,
}: {
  item: ActivityItem;
  width: number;
  spinnerFrame: number;
  expandedIds?: ReadonlySet<string>;
  registerRow?: (id: string, node: DOMElement | null) => void;
}) {
  switch (item.kind) {
    case "user":
      return <UserBlock item={item} width={width} />;
    case "assistant":
      return (
        <AssistantProse
          item={item}
          width={width}
          spinnerFrame={spinnerFrame}
        />
      );
    case "tool":
      return (
        <ToolRowLine
          item={item}
          width={width}
          spinnerFrame={spinnerFrame}
          expanded={expandedIds?.has(item.id)}
          registerRow={registerRow}
        />
      );
    case "plan":
      return <PlanBlock item={item} width={width} />;
    case "approval":
      return <ApprovalPrompt item={item} width={width} />;
    case "verify":
      return <VerifyResult item={item} width={width} />;
    case "note":
      return <NoteRow item={item} width={width} />;
    default:
      return null;
  }
}

/** Adjacent tool rows stay dense; everything else gets breathing room. */
function gapBefore(block: RenderBlock, prev: RenderBlock | undefined): number {
  if (!prev) return 0;
  const prevTool = prev.kind === "toolGroup" || (prev.kind === "single" && prev.item.kind === "tool");
  const nextTool = block.kind === "toolGroup" || (block.kind === "single" && block.item.kind === "tool");
  if (prevTool && nextTool) return 0;
  return 1;
}

export function Activity({
  blocks,
  width,
  spinnerFrame,
  expandedIds,
  registerRow,
}: {
  blocks: RenderBlock[];
  width: number;
  spinnerFrame: number;
  expandedIds?: ReadonlySet<string>;
  registerRow?: (id: string, node: DOMElement | null) => void;
}) {
  const border = resolve("border");
  const rule = glyph("hRule").repeat(Math.max(8, width));
  const inner = Math.max(8, width);
  return (
    <Box flexDirection="column" width={width}>
      <Text color={border}>{rule}</Text>
      {blocks.length === 0 ? (
        <Text color={resolve("text.muted")}> </Text>
      ) : (
        blocks.map((block, index) => (
          <Box
            key={block.kind === "toolGroup" ? block.id : block.item.id}
            marginTop={gapBefore(block, blocks[index - 1])}
          >
            {block.kind === "toolGroup" ? (
              <ToolGroupBlock
                group={block.group}
                items={block.items}
                width={inner}
                spinnerFrame={spinnerFrame}
                expandedIds={expandedIds}
                registerRow={registerRow}
              />
            ) : (
              <ActivityRowFor
                item={block.item}
                width={inner}
                spinnerFrame={spinnerFrame}
                expandedIds={expandedIds}
                registerRow={registerRow}
              />
            )}
          </Box>
        ))
      )}
      <Text color={border}>{rule}</Text>
    </Box>
  );
}
