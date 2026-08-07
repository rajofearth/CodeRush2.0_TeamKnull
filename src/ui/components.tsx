/**
 * ui/components — presentational pieces of the CLAI shell, implementing the
 * visual language locked in assets/23-visual-language.md.
 *
 * Every colour goes through `resolve(token)`; every glyph through `glyph()`.
 * Blocks are a left `▌` rule plus a panel background — never boxes with
 * corners. Chrome is lowercase; bold is reserved for section headings, the
 * session title, the bright wordmark half, and keybind keys.
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
  colorLevel,
  expandWordmarkRow,
  faintUsesDim,
  glyph,
  glyphs,
  resolve,
  tintHex,
  WORDMARK_LEFT,
  WORDMARK_RIGHT,
} from "./theme.js";

// ── formatting helpers ───────────────────────────────────────────────────────

/** `28221` → `28,221` (en-US thousands, per spec 6.1). */
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
 * (e.g. $0.0003 instead of rounding to $0.00).
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
 * One row of a panel block: a `▌` left rule, one space, content, padded to
 * `width` so the panel background reads as a surface. No corners, ever.
 */
export function BlockLine({
  width,
  ruleColor,
  segments,
  background = resolve("clai.backgroundPanel"),
}: {
  width: number;
  ruleColor?: string;
  segments: Segment[];
  background?: string;
}) {
  const pad = Math.max(0, width - 2 - segmentsLength(segments));
  return (
    <Text backgroundColor={background}>
      <Text color={ruleColor ?? resolve("clai.border")}>{glyph("leftRule")}</Text>
      <Text> </Text>
      <Segments segments={segments} />
      <Text>{" ".repeat(pad)}</Text>
    </Text>
  );
}

// ── wordmark ─────────────────────────────────────────────────────────────────

function wordmarkShadow(fgToken: "clai.textMuted" | "clai.text"): string | undefined {
  if (colorLevel() !== "truecolor") return resolve("clai.textFaint");
  const fg = resolve(fgToken);
  if (!fg) return undefined;
  return tintHex(fg, "#0a0a0a", 0.25);
}

function WordmarkHalf({
  rows,
  fgToken,
  bold,
}: {
  rows: string[];
  fgToken: "clai.textMuted" | "clai.text";
  bold: boolean;
}) {
  const fg = resolve(fgToken);
  const shadow = wordmarkShadow(fgToken);
  const truecolor = colorLevel() === "truecolor";
  return (
    <Box flexDirection="column">
      {rows.map((row, rowIndex) => (
        <Text key={rowIndex} bold={bold}>
          {expandWordmarkRow(row).map((cell, cellIndex) => {
            if (cell.paint === "shadowFg") {
              return (
                <Text key={cellIndex} color={shadow}>
                  {cell.char}
                </Text>
              );
            }
            if (cell.paint === "shadowBg") {
              return (
                <Text
                  key={cellIndex}
                  color={fg}
                  backgroundColor={truecolor ? shadow : undefined}
                >
                  {cell.char}
                </Text>
              );
            }
            return (
              <Text key={cellIndex} color={fg}>
                {cell.char}
              </Text>
            );
          })}
        </Text>
      ))}
    </Box>
  );
}

/** The `clai` wordmark: muted `cl`, one-column gap, bold bright `ai`. */
export function Wordmark() {
  return (
    <Box flexDirection="row">
      <WordmarkHalf rows={WORDMARK_LEFT} fgToken="clai.textMuted" bold={false} />
      <Text> </Text>
      <WordmarkHalf rows={WORDMARK_RIGHT} fgToken="clai.text" bold />
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
  const ruleColor = focused ? resolve("clai.accent") : resolve("clai.border");
  const inner = Math.max(8, width - 2);

  const inputSegments: Segment[] = value
    ? [
        { text: truncate(value, showCaret ? inner - 1 : inner), color: resolve("clai.text") },
        ...(showCaret ? [{ text: "▏", color: resolve("clai.textMuted") }] : []),
      ]
    : [{ text: truncate(placeholder, inner), color: resolve("clai.textMuted") }];

  const modelSegments: Segment[] = [
    { text: agent, color: resolve("clai.accent") },
  ];
  if (model) {
    modelSegments.push({ text: "  " }, { text: model, color: resolve("clai.text") });
  }
  if (provider) {
    modelSegments.push({ text: "  " }, { text: provider, color: resolve("clai.textMuted") });
  }

  return (
    <Box flexDirection="column" width={width}>
      <BlockLine width={width} ruleColor={ruleColor} segments={inputSegments} />
      <BlockLine width={width} ruleColor={ruleColor} segments={[]} />
      <BlockLine width={width} ruleColor={ruleColor} segments={modelSegments} />
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
          <Text bold color={resolve("clai.text")}>
            {hint.key}
          </Text>
          <Text color={resolve("clai.textMuted")}>{` ${hint.label}`}</Text>
        </Text>
      ))}
    </Text>
  );
}

// ── conversation blocks ──────────────────────────────────────────────────────

export function UserBlock({ item, width }: { item: UserItem; width: number }) {
  const lines = wrapText(item.text, Math.max(8, width - 2));
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <BlockLine
          key={index}
          width={width}
          segments={[{ text: line, color: resolve("clai.text") }]}
        />
      ))}
    </Box>
  );
}

export function AssistantProse({ item }: { item: AssistantItem }) {
  return (
    <Box>
      <Text wrap="wrap" color={resolve("clai.text")}>
        {item.text.trimEnd()}
        {item.done ? "" : <Text color={resolve("clai.accent")}>▏</Text>}
      </Text>
    </Box>
  );
}

// ── tool rows ────────────────────────────────────────────────────────────────

/** Sigils per spec 6.3: Read `→`, Grep `✳`, task `◈`, everything else `·`. */
export function toolSigil(tool: string): string {
  const name = tool.toLowerCase();
  if (name === "read") return glyph("sigilRead");
  if (name === "grep") return glyph("sigilSearch");
  if (name === "task" || name === "subagent") return glyph("sigilTask");
  return glyph("sigilDefault");
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
        <Text color={resolve("clai.accent")}>
          {frames[spinnerFrame % frames.length]}{" "}
        </Text>
        <Text color={resolve("clai.text")}>{verb}</Text>
        {target ? (
          <Text color={resolve("clai.textMuted")}>{` ${truncate(target, budget)}`}</Text>
        ) : null}
      </Box>
    );
  }

  if (item.status === "fail") {
    return (
      <Box flexDirection="column" paddingLeft={indent} ref={rowRef}>
        <Box>
          <Text color={resolve("clai.error")}>{glyph("statusDot")} </Text>
          <Text color={resolve("clai.text")}>{verb}</Text>
          {target ? (
            <Text color={resolve("clai.textMuted")}>{` ${truncate(target, budget)}`}</Text>
          ) : null}
          <Text color={resolve("clai.error")}> Failed</Text>
        </Box>
        {item.detail ? (
          <Box flexDirection="column">
            {wrapText(item.detail, Math.max(8, width - indent - 2)).map((line, i) => (
              <BlockLine
                key={i}
                width={width - indent}
                ruleColor={resolve("clai.error")}
                segments={[{ text: line, color: resolve("clai.textMuted") }]}
              />
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
        <Text color={resolve("clai.accent")}>{toolSigil(item.tool)} </Text>
        <Text color={resolve("clai.text")}>{verb}</Text>
        {target ? (
          <Text color={resolve("clai.textMuted")}>{` ${truncate(target, budget)}`}</Text>
        ) : null}
        {duration ? (
          <Text color={resolve("clai.textMuted")}>{`  ${duration}`}</Text>
        ) : null}
      </Box>
      {expanded && detail ? (
        <Box flexDirection="column">
          {wrapText(detail, Math.max(8, width - indent - 2)).map((line, i) => (
            <BlockLine
              key={i}
              width={width - indent}
              segments={[{ text: line, color: resolve("clai.textMuted") }]}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

/** A run of grouped tool rows: `explore 2/2` header, zero blank lines inside. */
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
    <Box flexDirection="column">
      <Box>
        <Text color={resolve("clai.text")}>{group}</Text>
        <Text color={resolve("clai.textMuted")}>{` ${done}/${items.length}`}</Text>
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

function todoBox(state: PlanStep["state"]): { box: string; boxColor?: string; textColor?: string } {
  switch (state) {
    case "done":
      return { box: "[x]", boxColor: resolve("clai.success"), textColor: resolve("clai.textFaint") };
    case "active":
      return { box: "[~]", boxColor: resolve("clai.accent"), textColor: resolve("clai.text") };
    case "failed":
      return { box: "[!]", boxColor: resolve("clai.error"), textColor: resolve("clai.text") };
    case "skipped":
      return { box: "[-]", boxColor: resolve("clai.textFaint"), textColor: resolve("clai.textFaint") };
    default:
      return { box: "[ ]", boxColor: resolve("clai.textMuted"), textColor: resolve("clai.textMuted") };
  }
}

export function PlanBlock({ item, width }: { item: PlanItem; width: number }) {
  const measure = Math.max(8, width - 6);
  return (
    <Box flexDirection="column">
      {item.steps.map((step, index) => {
        const { box, boxColor, textColor } = todoBox(step.state);
        const lines = wrapText(step.label, measure);
        return (
          <Box key={step.id ?? `${item.id}-${index}`} flexDirection="column">
            {lines.map((line, lineIndex) => (
              <BlockLine
                key={lineIndex}
                width={width}
                segments={
                  lineIndex === 0
                    ? [
                        { text: box, color: boxColor },
                        { text: ` ${line}`, color: textColor },
                      ]
                    : [{ text: `    ${line}`, color: textColor }]
                }
              />
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
  const color =
    item.decision === "denied"
      ? resolve("clai.error")
      : item.decision === "allowed" || item.decision === "auto"
        ? resolve("clai.success")
        : resolve("clai.warning");
  const lines = wrapText(item.request, Math.max(8, width - 2));
  return (
    <Box flexDirection="column">
      <BlockLine
        width={width}
        ruleColor={resolve("clai.warning")}
        segments={[
          { text: "approval", color: resolve("clai.text") },
          { text: `  ${item.tool}`, color: resolve("clai.textMuted") },
        ]}
      />
      {lines.map((line, index) => (
        <BlockLine
          key={index}
          width={width}
          ruleColor={resolve("clai.warning")}
          segments={[{ text: line, color: resolve("clai.textMuted") }]}
        />
      ))}
      <BlockLine
        width={width}
        ruleColor={resolve("clai.warning")}
        segments={[
          {
            text: decided
              ? `${item.decision}${item.reason ? ` · ${item.reason}` : ""}`
              : "waiting · y allow / n deny",
            color,
          },
        ]}
      />
    </Box>
  );
}

export function VerifyResult({ item, width }: { item: VerifyItem; width: number }) {
  const color = item.ok ? resolve("clai.success") : resolve("clai.error");
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{glyph("statusDot")} </Text>
        <Text color={resolve("clai.text")}>verify</Text>
        <Text color={resolve("clai.textMuted")}>{`  ${item.label}`}</Text>
        {item.detail ? (
          <Text color={resolve("clai.textMuted")}>
            {`  ${truncate(item.detail, Math.max(12, width - 30))}`}
          </Text>
        ) : null}
      </Box>
      {item.logPath ? (
        <Box paddingLeft={2}>
          <Text color={resolve("clai.textFaint")} dimColor={faintUsesDim()}>
            {item.logPath}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function NoteRow({ item, width }: { item: NoteItem; width: number }) {
  const color =
    item.level === "error"
      ? resolve("clai.error")
      : item.level === "warn"
        ? resolve("clai.warning")
        : resolve("clai.textMuted");
  return (
    <Box>
      <Text color={color}>{`${glyph("bullet")} ${item.label}`}</Text>
      {item.detail ? (
        <Text color={resolve("clai.textMuted")}>
          {`  ${truncate(item.detail, Math.max(12, width - item.label.length - 6))}`}
        </Text>
      ) : null}
    </Box>
  );
}

// ── in-flight line ───────────────────────────────────────────────────────────

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
  const frames = glyphs().spinnerFrames;
  const spinnerColor =
    status.level === "error"
      ? resolve("clai.error")
      : status.level === "warn"
        ? resolve("clai.warning")
        : resolve("clai.accent");
  return (
    <Box>
      <Text color={spinnerColor}>{frames[frame % frames.length]} </Text>
      <Text color={resolve("clai.text")}>{agent}</Text>
      <Text color={resolve("clai.textMuted")}>
        {model ? ` · ${model}` : ""}
        {`  ${truncate(status.label, Math.max(10, width - 30))}`}
        {status.detail ? `  ${truncate(status.detail, 40)}` : ""}
      </Text>
    </Box>
  );
}

// ── sidebar ──────────────────────────────────────────────────────────────────

export const SIDEBAR_WIDTH = 42;

function SectionHeading({ label }: { label: string }) {
  return (
    <Text bold color={resolve("clai.text")}>
      {label}
    </Text>
  );
}

export function Sidebar({
  context,
  metrics,
  todo,
  height,
  version,
}: {
  context: RunContext;
  metrics: RunMetrics;
  todo: PlanItem | null;
  height: number;
  version: string;
}) {
  const totalTokens = metrics.tokensIn + metrics.tokensOut;
  const pct = metrics.contextPct != null ? Math.round(metrics.contextPct) : null;
  const pctColor =
    pct == null
      ? resolve("clai.textMuted")
      : pct >= 95
        ? resolve("clai.error")
        : pct >= 80
          ? resolve("clai.warning")
          : resolve("clai.textMuted");

  return (
    <Box
      flexDirection="column"
      width={SIDEBAR_WIDTH}
      height={height}
      paddingLeft={1}
      paddingRight={1}
    >
      <Text bold color={context.title ? resolve("clai.text") : resolve("clai.textMuted")} wrap="wrap">
        {context.title ?? "New session"}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <SectionHeading label="Context" />
        <Text color={resolve("clai.textMuted")}>{`${formatTokens(totalTokens)} tokens`}</Text>
        {pct != null ? <Text color={pctColor}>{`${pct}% used`}</Text> : null}
        <Text color={resolve("clai.textMuted")}>{`${formatCost(metrics.costUsd)} spent`}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <SectionHeading label="MCP" />
        {context.mcp.length === 0 ? (
          <Text color={resolve("clai.textMuted")}>No MCP servers configured</Text>
        ) : (
          context.mcp.map((name) => (
            <Box key={name}>
              <Text color={resolve("clai.success")}>{glyph("statusDot")} </Text>
              <Text color={resolve("clai.text")}>{name}</Text>
              <Text color={resolve("clai.textMuted")}> Connected</Text>
            </Box>
          ))
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <SectionHeading label="LSP" />
        {context.lsp.length === 0 ? (
          <Text color={resolve("clai.textMuted")} wrap="wrap">
            LSPs will activate as files are read
          </Text>
        ) : (
          context.lsp.map((name) => (
            <Box key={name}>
              <Text color={resolve("clai.accent")}>{glyph("bullet")} </Text>
              <Text color={resolve("clai.textMuted")}>{name}</Text>
            </Box>
          ))
        )}
      </Box>
      {todo && todo.steps.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <SectionHeading label="Todo" />
          {todo.steps.map((step, index) => {
            const { box, boxColor, textColor } = todoBox(step.state);
            const lines = wrapText(step.label, SIDEBAR_WIDTH - 2 - 4);
            return (
              <Box key={step.id ?? index} flexDirection="column">
                {lines.map((line, lineIndex) => (
                  <Box key={lineIndex}>
                    {lineIndex === 0 ? (
                      <>
                        <Text color={boxColor}>{box}</Text>
                        <Text color={textColor}>{` ${line}`}</Text>
                      </>
                    ) : (
                      <Text color={textColor}>{`    ${line}`}</Text>
                    )}
                  </Box>
                ))}
              </Box>
            );
          })}
        </Box>
      ) : null}
      <Box flexGrow={1} />
      {context.cwd ? (
        <Text color={resolve("clai.textMuted")}>{truncate(context.cwd, SIDEBAR_WIDTH - 2)}</Text>
      ) : null}
      <Box>
        <Text color={resolve("clai.accent")}>{glyph("statusDot")} </Text>
        <Text color={resolve("clai.text")}>clai</Text>
        <Text color={resolve("clai.textMuted")}>{` ${version}`}</Text>
      </Box>
    </Box>
  );
}

// ── footer ───────────────────────────────────────────────────────────────────

export type FooterHint = { id: string; key: string; label: string };

/** Eight-cell progress bar: `███░░░░░`. */
export function ProgressBar({ fraction }: { fraction: number }) {
  const filled = Math.max(0, Math.min(8, Math.round(fraction * 8)));
  return (
    <Text>
      <Text color={resolve("clai.accent")}>
        {glyph("progressFull").repeat(filled)}
      </Text>
      <Text color={resolve("clai.textFaint")} dimColor={faintUsesDim()}>
        {glyph("progressIdle").repeat(8 - filled)}
      </Text>
    </Text>
  );
}

export function FooterBar({
  width,
  left,
  progress,
  interrupt,
  hints,
  registerHint,
}: {
  width: number;
  left?: string;
  /** 0..1 fills the eight-cell progress bar when set. */
  progress?: number;
  /** null = hidden, "armed" = `esc interrupt`, "confirm" = `esc again to interrupt` */
  interrupt: "armed" | "confirm" | null;
  hints: FooterHint[];
  registerHint?: (id: string, node: DOMElement | null) => void;
}) {
  const interruptText =
    interrupt === "confirm" ? "esc again to interrupt" : interrupt === "armed" ? "esc interrupt" : "";
  const leftPlain = [
    progress != null ? "████████" : null,
    left,
    interruptText,
  ]
    .filter(Boolean)
    .join("  ");
  const fit: FooterHint[] = [];
  let rightLen = 0;
  for (const hint of hints) {
    const len = hint.key.length + 1 + hint.label.length + (fit.length > 0 ? 2 : 0);
    if (leftPlain.length + rightLen + len + 2 > width) break;
    fit.push(hint);
    rightLen += len;
  }

  return (
    <Box width={width} flexDirection="row" justifyContent="space-between">
      <Box>
        {progress != null ? <ProgressBar fraction={progress} /> : null}
        {left ? (
          <Text color={resolve("clai.textMuted")}>
            {progress != null ? `  ${left}` : left}
          </Text>
        ) : null}
        {interrupt != null ? (
          <Box
            marginLeft={2}
            ref={(node) => registerHint?.("interrupt", node as DOMElement | null)}
          >
            <Text
              bold
              color={interrupt === "confirm" ? resolve("clai.warning") : resolve("clai.text")}
            >
              esc
            </Text>
            <Text color={resolve("clai.textMuted")}>
              {interrupt === "confirm" ? " again to interrupt" : " interrupt"}
            </Text>
          </Box>
        ) : null}
      </Box>
      <Box>
        {fit.map((hint, index) => (
          <Box
            key={hint.id}
            marginLeft={index > 0 ? 2 : 0}
            ref={(node) => registerHint?.(hint.id, node as DOMElement | null)}
          >
            <Text bold color={resolve("clai.text")}>
              {hint.key}
            </Text>
            <Text color={resolve("clai.textMuted")}>{` ${hint.label}`}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** Splash footer: `<cwd>  ● <n> MCP  /status` left, `clai <version>` right. */
export function SplashFooter({
  width,
  cwd,
  mcpCount,
  version,
}: {
  width: number;
  cwd?: string;
  mcpCount: number;
  version: string;
}) {
  return (
    <Box width={width} flexDirection="row" justifyContent="space-between">
      <Box>
        {cwd ? <Text color={resolve("clai.textMuted")}>{cwd}</Text> : null}
        {mcpCount > 0 ? (
          <Box marginLeft={cwd ? 2 : 0}>
            <Text color={resolve("clai.success")}>{glyph("statusDot")}</Text>
            <Text color={resolve("clai.text")}>{` ${mcpCount} MCP`}</Text>
          </Box>
        ) : null}
        <Box marginLeft={cwd || mcpCount > 0 ? 2 : 0}>
          <Text color={resolve("clai.textMuted")}>/status</Text>
        </Box>
      </Box>
      <Box>
        <Text color={resolve("clai.text")}>clai</Text>
        <Text color={resolve("clai.textMuted")}>{` ${version}`}</Text>
      </Box>
    </Box>
  );
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
      return <AssistantProse item={item} />;
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

/** Adjacent single tool rows stay dense (0 blank lines); everything else gets 1. */
function gapBefore(block: RenderBlock, prev: RenderBlock | undefined): number {
  if (!prev) return 1;
  const prevTool = prev.kind === "single" && prev.item.kind === "tool";
  const nextTool = block.kind === "single" && block.item.kind === "tool";
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
  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => (
        <Box
          key={block.kind === "toolGroup" ? block.id : block.item.id}
          marginTop={gapBefore(block, blocks[index - 1])}
        >
          {block.kind === "toolGroup" ? (
            <ToolGroupBlock
              group={block.group}
              items={block.items}
              width={width}
              spinnerFrame={spinnerFrame}
              expandedIds={expandedIds}
              registerRow={registerRow}
            />
          ) : (
            <ActivityRowFor
              item={block.item}
              width={width}
              spinnerFrame={spinnerFrame}
              expandedIds={expandedIds}
              registerRow={registerRow}
            />
          )}
        </Box>
      ))}
    </Box>
  );
}
