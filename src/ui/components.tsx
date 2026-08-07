/**
 * ui/components — presentational pieces of the CLAI shell.
 *
 * Layout primitives only (Ink Box/Text, flex, dim/bold/color). Color carries
 * status meaning; everything else is dim-for-secondary. No borders as
 * decoration, no ASCII frames, no theme abstraction.
 */

import React from "react";
import { Box, Text } from "ink";
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
  ToolStatus,
  UserItem,
  VerifyItem,
} from "./state.js";

const GLYPH = {
  ok: "✓",
  fail: "✗",
  pending: "·",
  group: "▸",
  user: "›",
  bullet: "•",
  gate: "!",
} as const;

export function statusGlyph(status: ToolStatus): string {
  return GLYPH[status];
}

export function statusColor(status: ToolStatus): string | undefined {
  if (status === "ok") return "green";
  if (status === "fail") return "red";
  return "yellow";
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

export function formatDuration(ms?: number): string | undefined {
  if (ms == null) return undefined;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

export function formatCost(usd?: number): string | undefined {
  if (usd == null) return undefined;
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** One-line ellipsis so a long path or command never reflows the log. */
export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1))}…`;
}

function Rule({ width }: { width: number }) {
  return <Text dimColor>{"─".repeat(Math.max(0, width))}</Text>;
}

// ── header ───────────────────────────────────────────────────────────────────

export function Header(props: {
  title: string;
  metrics: RunMetrics;
  width: number;
}) {
  const total = props.metrics.tokensIn + props.metrics.tokensOut;
  const right = [
    `${formatTokens(total)} tok`,
    props.metrics.contextPct != null
      ? `${Math.round(props.metrics.contextPct)}% ctx`
      : null,
    formatCost(props.metrics.costUsd),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Box>
          <Text color="cyan" bold>
            clai
          </Text>
          <Text dimColor>{"  "}</Text>
          <Text bold>{truncate(props.title, Math.max(10, props.width - right.length - 10))}</Text>
        </Box>
        <Text dimColor>{right}</Text>
      </Box>
      <Rule width={props.width} />
    </Box>
  );
}

// ── activity rows ────────────────────────────────────────────────────────────

function UserTurn({ item, width }: { item: UserItem; width: number }) {
  return (
    <Box marginTop={1}>
      <Text color="cyan">{GLYPH.user} </Text>
      <Text bold wrap="wrap">
        {truncate(item.text, width * 3)}
      </Text>
    </Box>
  );
}

function AssistantText({ item }: { item: AssistantItem }) {
  return (
    <Box marginTop={1} paddingLeft={2}>
      <Text wrap="wrap">
        {item.text}
        {item.done ? "" : <Text dimColor>▏</Text>}
      </Text>
    </Box>
  );
}

export function ToolRow({
  item,
  width,
  indent = 0,
}: {
  item: ToolItem;
  width: number;
  indent?: number;
}) {
  const duration = formatDuration(item.durationMs);
  const budget = Math.max(12, width - indent - item.tool.length - 18);
  const detail =
    item.detail && item.detail !== item.target ? item.detail : undefined;

  return (
    <Box paddingLeft={indent}>
      <Text color={statusColor(item.status)}>{statusGlyph(item.status)} </Text>
      <Text color={item.status === "fail" ? "red" : undefined}>
        {item.tool}
      </Text>
      {item.target ? (
        <Text dimColor>{`  ${truncate(item.target, budget)}`}</Text>
      ) : null}
      {detail ? (
        <Text dimColor>{`  ${truncate(detail, Math.min(budget, 40))}`}</Text>
      ) : null}
      {duration ? <Text dimColor>{`  ${duration}`}</Text> : null}
    </Box>
  );
}

function ToolGroup({
  group,
  items,
  width,
}: {
  group: string;
  items: ToolItem[];
  width: number;
}) {
  const done = items.filter((item) => item.status !== "pending").length;
  const failed = items.some((item) => item.status === "fail");
  const busy = done < items.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={busy ? "yellow" : failed ? "red" : "green"}>
          {busy ? GLYPH.pending : failed ? GLYPH.fail : GLYPH.ok}{" "}
        </Text>
        <Text bold>{group}</Text>
        <Text dimColor>{`  ${done}/${items.length}`}</Text>
      </Box>
      {items.map((item) => (
        <ToolRow key={item.id} item={item} width={width} indent={2} />
      ))}
    </Box>
  );
}

function planStepGlyph(state: PlanStep["state"], variant: PlanItem["variant"]) {
  if (state === "done") return variant === "todo" ? "[x]" : GLYPH.ok;
  if (state === "failed") return variant === "todo" ? "[!]" : GLYPH.fail;
  if (state === "active") return variant === "todo" ? "[~]" : GLYPH.group;
  if (state === "skipped") return variant === "todo" ? "[-]" : "-";
  return variant === "todo" ? "[ ]" : GLYPH.pending;
}

function planStepColor(state: PlanStep["state"]) {
  if (state === "done") return "green";
  if (state === "failed") return "red";
  if (state === "active") return "cyan";
  return undefined;
}

export function PlanBlock({ item, width }: { item: PlanItem; width: number }) {
  const heading =
    item.title ?? (item.variant === "todo" ? "todo" : "plan");
  const doneCount = item.steps.filter((s) => s.state === "done").length;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text bold color="magentaBright">
          {heading}
        </Text>
        <Text dimColor>{`  ${doneCount}/${item.steps.length}`}</Text>
        {item.revision != null && item.revision > 0 ? (
          <Text dimColor>{`  rev ${item.revision}`}</Text>
        ) : null}
      </Box>
      {item.steps.map((step, index) => (
        <Box key={step.id ?? `${item.id}-${index}`} paddingLeft={2}>
          <Text color={planStepColor(step.state)}>
            {planStepGlyph(step.state, item.variant)}{" "}
          </Text>
          <Text
            dimColor={step.state === "skipped"}
            strikethrough={step.state === "skipped"}
          >
            {truncate(step.label, Math.max(16, width - 12))}
          </Text>
          {step.detail ? (
            <Text dimColor>{`  ${truncate(step.detail, 30)}`}</Text>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

export function ApprovalPrompt({
  item,
  width,
}: {
  item: ApprovalItem;
  width: number;
}) {
  const decided = item.decision != null;
  const color =
    item.decision === "denied"
      ? "red"
      : item.decision === "allowed" || item.decision === "auto"
        ? "green"
        : "yellow";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={color} bold>
          {GLYPH.gate} approval
        </Text>
        <Text dimColor>{`  ${item.tool}`}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>{truncate(item.request, Math.max(20, width - 6))}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text color={color} dimColor={decided}>
          {decided
            ? `${item.decision}${item.reason ? ` · ${item.reason}` : ""}`
            : "waiting · y allow / n deny"}
        </Text>
      </Box>
    </Box>
  );
}

export function VerifyResult({
  item,
  width,
}: {
  item: VerifyItem;
  width: number;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={item.ok ? "green" : "red"} bold>
          {item.ok ? GLYPH.ok : GLYPH.fail} verify
        </Text>
        <Text>{`  ${item.label}`}</Text>
        {item.detail ? (
          <Text dimColor>{`  ${truncate(item.detail, Math.max(12, width - 30))}`}</Text>
        ) : null}
      </Box>
      {item.logPath ? (
        <Box paddingLeft={2}>
          <Text dimColor>{item.logPath}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function Note({ item, width }: { item: NoteItem; width: number }) {
  const color =
    item.level === "error" ? "red" : item.level === "warn" ? "yellow" : undefined;
  return (
    <Box>
      <Text color={color} dimColor={item.level === "info"}>
        {item.level === "info" ? `${GLYPH.bullet} ` : `${GLYPH.gate} `}
        {item.label}
      </Text>
      {item.detail ? (
        <Text dimColor>{`  ${truncate(item.detail, Math.max(12, width - item.label.length - 8))}`}</Text>
      ) : null}
    </Box>
  );
}

export function ActivityRowFor({
  item,
  width,
}: {
  item: ActivityItem;
  width: number;
}) {
  switch (item.kind) {
    case "user":
      return <UserTurn item={item} width={width} />;
    case "assistant":
      return <AssistantText item={item} />;
    case "tool":
      return <ToolRow item={item} width={width} />;
    case "plan":
      return <PlanBlock item={item} width={width} />;
    case "approval":
      return <ApprovalPrompt item={item} width={width} />;
    case "verify":
      return <VerifyResult item={item} width={width} />;
    case "note":
      return <Note item={item} width={width} />;
    default:
      return null;
  }
}

export function Activity({
  blocks,
  width,
}: {
  blocks: RenderBlock[];
  width: number;
}) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {blocks.map((block) =>
        block.kind === "toolGroup" ? (
          <ToolGroup
            key={block.id}
            group={block.group}
            items={block.items}
            width={width}
          />
        ) : (
          <ActivityRowFor
            key={block.item.id}
            item={block.item}
            width={width}
          />
        ),
      )}
    </Box>
  );
}

// ── working line ─────────────────────────────────────────────────────────────

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function StatusLine({
  status,
  frame,
  width,
}: {
  status: { label: string; detail?: string; level: string } | null;
  frame: number;
  width: number;
}) {
  if (!status) return null;
  const color =
    status.level === "error" ? "red" : status.level === "warn" ? "yellow" : "cyan";
  return (
    <Box marginTop={1}>
      <Text color={color}>{SPINNER[frame % SPINNER.length]} </Text>
      <Text dimColor>{truncate(status.label, Math.max(10, width - 20))}</Text>
      {status.detail ? (
        <Text dimColor>{`  ${truncate(status.detail, 30)}`}</Text>
      ) : null}
    </Box>
  );
}

// ── context strip ────────────────────────────────────────────────────────────

function StripLine({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text dimColor>{label.padEnd(9)}</Text>
      <Text>{value}</Text>
    </Box>
  );
}

export function ContextStrip({
  context,
  metrics,
  width,
}: {
  context: RunContext;
  metrics: RunMetrics;
  width: number;
}) {
  const short = (value?: string) =>
    value ? truncate(value, Math.max(8, width - 10)) : undefined;
  const lines: Array<[string, string | undefined]> = [
    ["run", short(context.runId)],
    ["cwd", short(context.cwd)],
    ["sandbox", context.sandboxMode],
    ["tokens", `${formatTokens(metrics.tokensIn)}↑ ${formatTokens(metrics.tokensOut)}↓`],
    [
      "context",
      metrics.contextPct != null ? `${Math.round(metrics.contextPct)}%` : undefined,
    ],
    ["cost", formatCost(metrics.costUsd)],
    ["mcp", context.mcp.length ? context.mcp.join(", ") : "none"],
    ["lsp", context.lsp.length ? context.lsp.join(", ") : "none"],
    [
      "memory",
      context.memoryInjected != null
        ? `${context.memoryInjected} in · ${context.memoryDropped ?? 0} out`
        : undefined,
    ],
  ];

  return (
    <Box flexDirection="column" width={width} paddingLeft={2}>
      {lines
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([label, value]) => (
          <StripLine key={label} label={label} value={value} />
        ))}
    </Box>
  );
}

// ── footer ───────────────────────────────────────────────────────────────────

export type Shortcut = { key: string; label: string; disabled?: boolean };

export function Footer({
  context,
  shortcuts,
  width,
}: {
  context: RunContext;
  shortcuts: Shortcut[];
  width: number;
}) {
  const left = [context.agent ?? "build", context.model].filter(Boolean).join(" · ");
  return (
    <Box flexDirection="column" marginTop={1}>
      <Rule width={width} />
      <Box justifyContent="space-between">
        <Text dimColor>{truncate(left || "clai", Math.floor(width / 2))}</Text>
        <Box>
          {shortcuts.map((shortcut, index) => (
            <Text key={shortcut.key} dimColor>
              {index > 0 ? "  " : ""}
              <Text color={shortcut.disabled ? undefined : "cyan"} dimColor={shortcut.disabled}>
                {shortcut.key}
              </Text>
              {` ${shortcut.label}`}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export function InputLine({
  value,
  placeholder,
  readOnly,
  width,
}: {
  value: string;
  placeholder?: string;
  readOnly?: boolean;
  width: number;
}) {
  return (
    <Box>
      <Text color={readOnly ? undefined : "cyan"} dimColor={readOnly}>
        {"❯ "}
      </Text>
      {value ? (
        <Text>{truncate(value, Math.max(10, width - 4))}</Text>
      ) : (
        <Text dimColor>{placeholder ?? ""}</Text>
      )}
      {readOnly ? null : <Text dimColor>▏</Text>}
    </Box>
  );
}
