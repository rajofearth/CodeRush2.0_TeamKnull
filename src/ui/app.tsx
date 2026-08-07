/**
 * ui/app — CLAI ADE shell: activity · plan · approvals · strip.
 *
 * Rendering-layer only. Producers emit `UiEvent`s; this shell folds them via
 * `reduceUiEvent` and paints with the metallic theme. Terminal modes (alt
 * screen + SGR mouse) tear down on exit.
 */

import { createRequire } from "node:module";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import type { DOMElement } from "ink";
import type { UiBus, UiEvent } from "./events.js";
import { createUiBus } from "./events.js";
import {
  groupItems,
  initialUiState,
  reduceUiEvent,
  type ActivityItem,
  type ApprovalItem,
  type PlanItem,
  type RenderBlock,
  type RunContext,
  type UiState,
} from "./state.js";
import {
  Activity,
  ApprovalsPane,
  BrandIntro,
  BRAND_INTRO_INTERVAL_MS,
  BRAND_INTRO_TOTAL_TICKS,
  ContextStrip,
  HintLine,
  LifecycleLine,
  PlanPane,
  PromptBox,
  SIDEBAR_WIDTH,
  ScrollCue,
  StatsPanel,
  StickyUserCue,
  Wordmark,
  deriveLifecycle,
  shouldPlayBrandIntro,
  type FooterHint,
} from "./components.js";
import {
  armMouse,
  createHitRegistry,
  enterAltScreen,
  isMouseEnabled,
  scrubMouseJunk,
  type HitRegistry,
} from "./mouse.js";
import { measureHeights, windowByLines } from "./scroll.js";
import { glyphs } from "./theme.js";

const SIDEBAR_MIN_WIDTH = 120;
const ESC_CONFIRM_MS = 5000;
const PLACEHOLDER_EXAMPLES = [
  "fix the failing edit tool test",
  "explain the sandbox approval path",
  "add a field that validates age ≥ 18",
  "run the offline demo and summarise",
];

function readPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    return pkg.version ?? "0.0.1";
  } catch {
    return "0.0.1";
  }
}

const CLAI_VERSION = readPackageVersion();
void CLAI_VERSION;

function titleCaseAgent(agent?: string): string {
  if (!agent) return "Build";
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

/** Split `provider/model` when producers stuff both into `context.model`. */
function splitModel(raw?: string): { model?: string; provider?: string } {
  if (!raw) return {};
  const slash = raw.indexOf("/");
  if (slash <= 0) return { model: raw };
  return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) };
}

function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });

  useEffect(() => {
    if (!stdout) return;
    const onResize = () =>
      setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}

function latestTodo(items: ActivityItem[]): PlanItem | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    if (item.kind === "plan" && item.variant === "todo") return item;
  }
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    if (item.kind === "plan") return item;
  }
  return null;
}

function pendingApprovals(items: ActivityItem[]): ApprovalItem[] {
  return items.filter(
    (item): item is ApprovalItem =>
      item.kind === "approval" && item.decision == null,
  );
}

/** Latest user prompt text for the sticky scrolled-up cue. */
function latestUserText(items: ActivityItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    if (item.kind === "user" && item.text.trim()) return item.text;
  }
  return null;
}


/** Activity stream without the latest plan/todo (shown in the plan pane). */
function activityBlocks(items: ActivityItem[], todo: PlanItem | null): RenderBlock[] {
  const filtered = todo
    ? items.filter((item) => !(item.kind === "plan" && item.id === todo.id))
    : items;
  return groupItems(filtered);
}

function placeholderFor(tick: number): string {
  const example = PLACEHOLDER_EXAMPLES[tick % PLACEHOLDER_EXAMPLES.length]!;
  return `Ask anything... "${example}"`;
}

export type ShellApi = {
  emit: (event: UiEvent) => void;
  done: (exitCode?: number) => void;
};

export type ClaiAppProps = {
  bus: UiBus;
  context?: Partial<RunContext>;
  interactive?: boolean;
  /** Called when the user submits a chat line (Enter). */
  onSubmit?: (text: string) => void;
  onInterrupt?: () => void;
  onReady?: (api: ShellApi) => void;
  exitWhenDone?: boolean;
};

export function ClaiApp(props: ClaiAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { columns, rows } = useTerminalSize();
  const [state, setState] = useState<UiState>(() =>
    initialUiState(props.context),
  );
  const [frame, setFrame] = useState(0);
  const [placeholderTick, setPlaceholderTick] = useState(0);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [scrollFromBottom, setScrollFromBottom] = useState(0);
  const [busy, setBusy] = useState(false);
  const [escArmedUntil, setEscArmedUntil] = useState(0);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [introTick, setIntroTick] = useState(0);
  const [introDone, setIntroDone] = useState(
    () =>
      !shouldPlayBrandIntro({
        interactive: props.interactive,
        stdout,
      }),
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  /** Forces StatsPanel to refresh even when Ink batches quietly. */
  const [statsEpoch, setStatsEpoch] = useState(0);
  const liveStatsRef = useRef({
    tokensIn: 0,
    tokensOut: 0,
    costUsd: undefined as number | undefined,
    toolCalls: 0,
  });
  const taskStartedAt = useRef<number | null>(null);
  const interrupt = useRef(props.onInterrupt);
  interrupt.current = props.onInterrupt;
  const onSubmit = useRef(props.onSubmit);
  onSubmit.current = props.onSubmit;
  const scrollRef = useRef(0);
  scrollRef.current = scrollFromBottom;
  const maxScrollRef = useRef(0);
  const totalLinesRef = useRef(0);
  const hitRegistry = useRef<HitRegistry>(createHitRegistry());
  const hintActions = useRef(new Map<string, () => void>());
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Brand intro — letter reveal + metallic shimmer on real interactive TTY.
  useEffect(() => {
    if (introDone) return;
    const timer = setInterval(() => {
      setIntroTick((n) => {
        if (n + 1 >= BRAND_INTRO_TOTAL_TICKS) {
          setIntroDone(true);
          return n + 1;
        }
        return n + 1;
      });
    }, BRAND_INTRO_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [introDone]);

  useEffect(() => {
    if (!stdout?.isTTY || stdout !== process.stdout) return;
    const disposeAlt = enterAltScreen(stdout);
    const disposers: Array<() => void> = [disposeAlt];

    if (isMouseEnabled() && process.stdin.isTTY) {
      const hits = hitRegistry.current;
      const disposeMouse = armMouse({
        stdin: process.stdin,
        stdout,
        handlers: {
          onWheel: (direction) => {
            // direction -1 = wheel up → older; +1 = toward live edge (follow).
            // Pi-style: ±3 lines; snap to follow when ≤2 lines from live edge.
            if (direction < 0) {
              setScrollFromBottom((n) =>
                Math.min(n + 3, maxScrollRef.current),
              );
            } else {
              setScrollFromBottom((n) => {
                const next = Math.max(0, n - 3);
                return next <= 2 ? 0 : next;
              });
            }
          },
          onClick: (x, y) => {
            const action = hits.hitTest(x, y);
            action?.();
          },
        },
      });
      disposers.push(disposeMouse);
    }

    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  }, [stdout]);

  useEffect(() => {
    const unsubscribe = props.bus.subscribe((event) => {
      setState((prev) => reduceUiEvent(prev, event));

      const bumpStats = () => setStatsEpoch((n) => n + 1);

      if (event.type === "status") {
        if (
          event.done &&
          (event.label === "processed" ||
            event.label === "interrupted" ||
            event.label === "error")
        ) {
          setBusy(false);
        } else if (event.label && !event.done) {
          setBusy(true);
        }
      }

      if (event.type === "user") {
        setScrollFromBottom(0);
        setBusy(true);
        taskStartedAt.current = Date.now();
        setElapsedMs(0);
        bumpStats();
      }

      if (event.type === "metrics") {
        const cur = liveStatsRef.current;
        if (event.tokensIn != null) cur.tokensIn = event.tokensIn;
        if (event.tokensOut != null) cur.tokensOut = event.tokensOut;
        if (event.costUsd != null) cur.costUsd = event.costUsd;
        bumpStats();
      }

      if (event.type === "tool_call") {
        liveStatsRef.current.toolCalls += 1;
        bumpStats();
      }
    });
    props.onReady?.({
      emit: (event) => props.bus.emit(event),
      done: (code = 0) => setExitCode(code),
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todo = latestTodo(state.items);
  const approvals = pendingApprovals(state.items);
  const blocks = useMemo(
    () => activityBlocks(state.items, todo),
    [state.items, todo],
  );

  const pendingTools = state.items.some(
    (item) => item.kind === "tool" && item.status === "pending",
  );
  const assistantStreaming = state.items.some(
    (item) => item.kind === "assistant" && !item.done,
  );

  const lifecycle = useMemo(() => {
    if (exitCode != null) return null;
    const derived = deriveLifecycle({
      status: state.status,
      items: state.items,
    });
    if (derived) return derived;
    // Keep the Working / Verify animation alive for the whole turn even when
    // transient status events clear (e.g. intake ready).
    if (assistantStreaming) {
      return { state: "verify" as const, detail: "streaming reply" };
    }
    if (pendingTools) {
      return { state: "working" as const, detail: "tool calls" };
    }
    if (busy) {
      return {
        state: "working" as const,
        detail: state.status?.label,
      };
    }
    return null;
  }, [
    exitCode,
    state.status,
    state.items,
    assistantStreaming,
    pendingTools,
    busy,
  ]);

  const spinning =
    lifecycle != null &&
    (lifecycle.state === "working" ||
      lifecycle.state === "verify" ||
      lifecycle.state === "repair");
  useEffect(() => {
    if (!spinning) return;
    const timer = setInterval(
      () => setFrame((n) => n + 1),
      glyphs().spinnerIntervalMs,
    );
    return () => clearInterval(timer);
  }, [spinning]);

  // Always tick the clock while a turn is in flight so the stats panel moves.
  const taskActive = busy || pendingTools || assistantStreaming || state.status != null;
  useEffect(() => {
    if (taskActive && taskStartedAt.current == null) {
      taskStartedAt.current = Date.now();
    }
    if (!taskActive) return;
    const tick = () => {
      if (taskStartedAt.current != null) {
        setElapsedMs(Date.now() - taskStartedAt.current);
        setStatsEpoch((n) => n + 1);
      }
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [taskActive]);

  useEffect(() => {
    const timer = setInterval(() => setPlaceholderTick((n) => n + 1), 8000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (exitCode == null) return;
    process.exitCode = exitCode;
    if (props.exitWhenDone === false) return;
    const timer = setTimeout(() => exit(), 60);
    return () => clearTimeout(timer);
  }, [exitCode, exit, props.exitWhenDone]);

  const requestInterrupt = useCallback(() => {
    const now = Date.now();
    if (now < escArmedUntil) {
      setEscArmedUntil(0);
      interrupt.current?.();
      return;
    }
    setEscArmedUntil(now + ESC_CONFIRM_MS);
  }, [escArmedUntil]);

  useEffect(() => {
    if (escArmedUntil <= 0) return;
    const remaining = escArmedUntil - Date.now();
    if (remaining <= 0) {
      setEscArmedUntil(0);
      return;
    }
    const timer = setTimeout(() => setEscArmedUntil(0), remaining);
    return () => clearTimeout(timer);
  }, [escArmedUntil]);

  // Full-terminal layout: conversation fills remaining width; soft wrap for prose.
  const PAD = columns >= 100 ? 2 : 1;
  const showStats = columns >= 72;
  const showSidebar = columns >= SIDEBAR_MIN_WIDTH;
  // Compact horizontal stats need ~44–52 cols for `time · tokens · cost · tools`.
  const STATS_W = columns >= 140 ? 52 : columns >= 100 ? 48 : 44;
  const conversationWidth = Math.max(
    24,
    showSidebar ? columns - SIDEBAR_WIDTH - PAD * 2 : columns - PAD * 2,
  );
  const contentWidth = Math.max(16, conversationWidth - 2);
  // Cap readable prose on ultra-wide; column stays full-width around it.
  const proseWidth = Math.min(
    contentWidth,
    columns >= 140 ? 100 : contentWidth,
  );
  const showPlanInline = !showSidebar;
  const stickyUser =
    scrollFromBottom > 0 ? latestUserText(state.items) : null;

  // Wordmark + compact StatsPanel (2 rows) share a row; +1 for header marginBottom.
  const headerRows = showStats ? 3 : 2;
  const promptRows = props.interactive ? 4 : 0;
  const planRows =
    showPlanInline && todo
      ? Math.min(10, 2 + (todo.steps?.length ?? 0))
      : 0;
  const approvalRows =
    approvals.length > 0 ? Math.min(8, 1 + approvals.length * 3) : 0;
  const cueRows = 2;
  const stripRows = 1;
  const activityBudget = Math.max(
    6,
    rows -
      headerRows -
      promptRows -
      planRows -
      approvalRows -
      cueRows -
      stripRows -
      2,
  );
  // Activity paints top+bottom border rules — reserve 2 rows in the window budget.
  // Sticky user cue takes one row when scrolled up.
  const stickyRows = stickyUser ? 1 : 0;
  const budget = Math.max(4, activityBudget - 2 - stickyRows);

  const heights = useMemo(
    () => measureHeights(blocks, proseWidth),
    [blocks, proseWidth],
  );
  const totalLines = useMemo(
    () => heights.reduce((a, b) => a + b, 0),
    [heights],
  );

  // Pi-style sticky follow: when pinned (scrollFromBottom === 0), stay at end.
  // When scrolled up, keep scrollTop fixed → grow scrollFromBottom by Δ totalLines.
  useEffect(() => {
    const prev = totalLinesRef.current;
    totalLinesRef.current = totalLines;
    if (totalLines <= prev) return;
    if (scrollRef.current > 0) {
      setScrollFromBottom((n) => n + (totalLines - prev));
    }
  }, [totalLines]);

  const {
    visible,
    clipTop,
    atBottom,
    canScrollUp,
    hiddenBelowLines,
    hiddenAboveLines,
    maxScroll,
  } = useMemo(
    () => windowByLines(blocks, heights, budget, scrollFromBottom),
    [blocks, heights, budget, scrollFromBottom],
  );

  maxScrollRef.current = maxScroll;

  // Clamp when maxScroll shrinks (resize / fewer lines).
  useEffect(() => {
    setScrollFromBottom((n) => Math.min(n, maxScroll));
  }, [maxScroll]);

  // Pi page step: viewport − 1 lines.
  const pageLines = Math.max(1, budget - 1);

  const scrollUp = useCallback(() => {
    setScrollFromBottom((n) => Math.min(n + pageLines, maxScroll));
  }, [pageLines, maxScroll]);

  const scrollDown = useCallback(() => {
    setScrollFromBottom((n) => {
      const next = Math.max(0, n - pageLines);
      return next <= 2 ? 0 : next;
    });
  }, [pageLines]);

  /** Resume follow mode (jump to live edge). */
  const followLive = useCallback(() => {
    setScrollFromBottom(0);
  }, []);

  /** Reveal newer content; snap to live edge when close enough (≤2 lines). */
  const expandBelow = useCallback(() => {
    setScrollFromBottom((n) => {
      const next = Math.max(0, n - pageLines);
      return next <= 2 ? 0 : next;
    });
  }, [pageLines]);

  const expandAbove = useCallback(() => {
    setScrollFromBottom((n) => Math.min(n + pageLines, maxScroll));
  }, [pageLines, maxScroll]);

  useInput(
    (ch, key) => {
      if (!introDone) {
        setIntroDone(true);
        return;
      }
      if (key.escape) {
        if (props.onInterrupt && (busy || state.status != null)) {
          requestInterrupt();
        }
        return;
      }
      if (key.pageUp || (key.ctrl && ch === "u")) {
        scrollUp();
        return;
      }
      if (key.pageDown || (key.ctrl && ch === "d")) {
        scrollDown();
        return;
      }
      if (!props.interactive || busy || exitCode != null) return;

      if (key.return) {
        const text = input.trim();
        if (!text) return;
        setInput("");
        setBusy(true);
        onSubmit.current?.(text);
        return;
      }
      if (key.backspace || key.delete) {
        setInput((v) => scrubMouseJunk(v.slice(0, -1)));
        return;
      }
      if (ch && (ch === "\x1b" || /\[<\d*;?\d*;?\d*[Mm]?/.test(ch))) {
        setInput((v) => scrubMouseJunk(v));
        return;
      }
      if (ch && !key.ctrl && !key.meta) {
        setInput((v) => scrubMouseJunk(v + ch));
      }
    },
    { isActive: true },
  );

  const agentLabel = titleCaseAgent(state.context.agent);
  const { model, provider } = splitModel(state.context.model);

  // Prefer the live ref (updated on every bus event) over lagged reducer state.
  const live = liveStatsRef.current;
  const toolCalls = Math.max(
    live.toolCalls,
    state.items.filter((item) => item.kind === "tool").length,
  );
  const tokensIn = Math.max(live.tokensIn, state.metrics.tokensIn);
  const tokensOut = Math.max(live.tokensOut, state.metrics.tokensOut);
  const liveCost = live.costUsd ?? state.metrics.costUsd;

  const sessionStats = {
    elapsedMs,
    tokensIn,
    tokensOut,
    costUsd: liveCost,
    toolCalls,
    live: busy || pendingTools || assistantStreaming,
  };
  // Keep statsEpoch in the render dependency path.
  void statsEpoch;

  const interruptMode: "armed" | "confirm" | null =
    props.onInterrupt && (busy || state.status != null)
      ? Date.now() < escArmedUntil
        ? "confirm"
        : "armed"
      : null;

  const footerHints: FooterHint[] = [
    ...(interruptMode
      ? [
          {
            id: "interrupt",
            key: "esc",
            label:
              interruptMode === "confirm" ? "again to interrupt" : "interrupt",
          },
        ]
      : []),
    { id: "scroll", key: "pgup/dn", label: "scroll" },
  ];

  hintActions.current.set("interrupt", () => requestInterrupt());
  hintActions.current.set("scroll", () => scrollUp());
  hintActions.current.set("more-below", () => expandBelow());
  hintActions.current.set("more-above", () => expandAbove());
  hintActions.current.set("follow", () => followLive());

  const registerRow = useCallback(
    (id: string, node: DOMElement | null) => {
      if (!node) {
        hitRegistry.current.unregister(`tool:${id}`);
        return;
      }
      hitRegistry.current.register(`tool:${id}`, node, () => toggleExpand(id));
    },
    [toggleExpand],
  );

  const registerHint = useCallback((id: string, node: DOMElement | null) => {
    if (!node) {
      hitRegistry.current.unregister(`hint:${id}`);
      return;
    }
    hitRegistry.current.register(`hint:${id}`, node, () => {
      hintActions.current.get(id)?.();
    });
  }, []);

  const registerScrollCue = useCallback(
    (id: "more-below" | "more-above", node: DOMElement | null) => {
      registerHint(id, node);
    },
    [registerHint],
  );

  const promptHints = [
    { key: "tab", label: "switch agent" },
    { key: "ctrl+p", label: "commands" },
  ];

  if (!introDone) {
    return (
      <Box
        flexDirection="column"
        width={columns}
        height={rows}
        alignItems="center"
        justifyContent="center"
      >
        <BrandIntro tick={introTick} width={columns} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {/* Header — flexShrink 0 */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
        paddingX={PAD}
        marginBottom={1}
        width={columns}
      >
        <Wordmark
          cwd={state.context.cwd}
          showCwd={columns >= 100 && Boolean(state.context.cwd)}
        />
        {showStats ? (
          <StatsPanel
            key={`stats-${statsEpoch}-${tokensOut}-${toolCalls}-${elapsedMs}`}
            stats={sessionStats}
            width={STATS_W}
          />
        ) : null}
      </Box>

      {/* Body — grows: scrollback → turn status → composer → strip */}
      <Box
        flexDirection="row"
        flexGrow={1}
        width={columns}
        paddingX={PAD}
        minHeight={0}
      >
        <Box
          flexDirection="column"
          flexGrow={1}
          width={conversationWidth}
          minHeight={0}
          height="100%"
        >
          {/* Sticky latest-user cue when scrolled away from live edge */}
          {stickyUser && !atBottom ? (
            <StickyUserCue text={stickyUser} width={proseWidth} />
          ) : null}

          {canScrollUp ? (
            <ScrollCue
              direction="up"
              label={
                hiddenAboveLines > 0
                  ? `${hiddenAboveLines} lines above`
                  : `scroll (${scrollFromBottom} lines from bottom)`
              }
              register={(node) => registerScrollCue("more-above", node)}
            />
          ) : null}

          {/* ONLY this region grows — prose capped, column full-width */}
          <Box
            flexGrow={1}
            flexDirection="column"
            width={conversationWidth}
            justifyContent="flex-start"
            minHeight={0}
            overflow="hidden"
          >
            <Box width={proseWidth}>
              <Activity
                blocks={visible}
                width={proseWidth}
                spinnerFrame={frame}
                expandedIds={expandedIds}
                registerRow={registerRow}
                clipTop={clipTop}
              />
            </Box>
          </Box>

          {!atBottom ? (
            <ScrollCue
              direction="down"
              label={
                hiddenBelowLines > 0
                  ? `${hiddenBelowLines} lines below · follow live`
                  : "follow live"
              }
              register={(node) => registerScrollCue("more-below", node)}
            />
          ) : null}

          {/* Approvals stay near composer; plan is secondary (sidebar or quiet inline) */}
          <Box flexShrink={0}>
            <ApprovalsPane items={approvals} width={proseWidth} />
          </Box>
          {showPlanInline ? (
            <Box flexShrink={0}>
              <PlanPane todo={todo} width={proseWidth} />
            </Box>
          ) : null}

          {/* Turn status immediately above composer */}
          <Box flexShrink={0} marginTop={1} width={proseWidth}>
            <LifecycleLine
              phase={lifecycle}
              frame={frame}
              width={proseWidth}
              elapsedMs={taskActive ? elapsedMs : undefined}
            />
          </Box>

          {props.interactive ? (
            <Box flexDirection="column" flexShrink={0} marginTop={0}>
              <PromptBox
                width={proseWidth}
                value={input}
                placeholder={
                  busy ? "working…" : placeholderFor(placeholderTick)
                }
                focused={!busy}
                agent={agentLabel}
                model={model}
                provider={provider}
                showCaret={!busy && input.length > 0}
              />
              {!busy ? (
                <HintLine width={proseWidth} hints={promptHints} />
              ) : null}
            </Box>
          ) : null}
        </Box>

        {showSidebar ? (
          <Box
            flexShrink={0}
            width={SIDEBAR_WIDTH}
            paddingLeft={1}
            height="100%"
          >
            <PlanPane todo={todo} width={SIDEBAR_WIDTH - 2} />
          </Box>
        ) : null}
      </Box>

      <Box flexShrink={0} width={columns}>
        <ContextStrip
          width={columns}
          context={state.context}
          metrics={{
            tokensIn,
            tokensOut,
            costUsd: liveCost,
            contextPct: state.metrics.contextPct,
          }}
          lifecycle={lifecycle}
          hints={footerHints}
          interrupt={interruptMode}
          registerHint={registerHint}
        />
      </Box>
    </Box>
  );
}

export type RenderShellOptions = {
  context?: Partial<RunContext>;
  interactive?: boolean;
  onSubmit?: (text: string) => void;
  onInterrupt?: () => void;
  bus?: UiBus;
  exitWhenDone?: boolean;
};

export type ShellHandle = ShellApi & {
  bus: UiBus;
  waitUntilExit: () => Promise<void>;
};

export async function renderShell(
  opts: RenderShellOptions = {},
): Promise<ShellHandle> {
  const { render } = await import("ink");
  const bus = opts.bus ?? createUiBus();

  let waitUntilExit: () => Promise<void> = async () => {};
  const ready = new Promise<ShellApi>((resolveReady) => {
    const instance = render(
      <ClaiApp
        bus={bus}
        context={opts.context}
        interactive={opts.interactive}
        onSubmit={opts.onSubmit}
        onInterrupt={opts.onInterrupt}
        onReady={resolveReady}
        exitWhenDone={opts.exitWhenDone}
      />,
    );
    waitUntilExit = () => instance.waitUntilExit();
  });

  const api = await ready;

  return {
    bus,
    emit: api.emit,
    done: api.done,
    waitUntilExit: () => waitUntilExit(),
  };
}
