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

function blockHeight(block: RenderBlock): number {
  if (block.kind === "toolGroup") return block.items.length + 2;
  const item: ActivityItem = block.item;
  switch (item.kind) {
    case "plan":
      return item.steps.length + 2;
    case "approval":
      return 4;
    case "verify":
      return item.logPath ? 3 : 2;
    case "assistant": {
      // Streaming view tails the last ~18 lines so the live edge stays on screen.
      const lines = item.text.split(/\r?\n/);
      const shown = item.done ? lines.length : Math.min(18, lines.length);
      return 3 + Math.max(1, shown);
    }
    case "user":
      return 2 + Math.ceil(item.text.length / 70);
    default:
      return 1;
  }
}

function windowBlocks(
  blocks: RenderBlock[],
  budget: number,
  scrollFromBottom: number,
): {
  visible: RenderBlock[];
  atBottom: boolean;
  canScrollUp: boolean;
  hiddenBelow: number;
  hiddenAbove: number;
  maxScroll: number;
} {
  if (blocks.length === 0) {
    return {
      visible: [],
      atBottom: true,
      canScrollUp: false,
      hiddenBelow: 0,
      hiddenAbove: 0,
      maxScroll: 0,
    };
  }

  const heights = blocks.map(blockHeight);

  // Fit as many trailing blocks as the budget allows (follow / live edge).
  let used = 0;
  let fitCount = 0;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const h = heights[i]!;
    if (used + h > budget && fitCount > 0) break;
    used += h;
    fitCount += 1;
  }

  const maxScroll = Math.max(0, blocks.length - fitCount);
  // Grok-style follow: scrollFromBottom === 0 pins to the live edge.
  const scroll = Math.max(0, Math.min(scrollFromBottom, maxScroll));
  const end = blocks.length - scroll;

  const visibleIdx: number[] = [];
  let u = 0;
  for (let i = end - 1; i >= 0; i -= 1) {
    const h = heights[i]!;
    if (u + h > budget && visibleIdx.length > 0) break;
    visibleIdx.unshift(i);
    u += h;
  }

  const first = visibleIdx[0] ?? 0;
  const last = visibleIdx[visibleIdx.length - 1] ?? -1;

  return {
    visible: visibleIdx.map((i) => blocks[i]!),
    atBottom: scroll <= 0,
    canScrollUp: first > 0 || scroll > 0,
    hiddenBelow: Math.max(0, blocks.length - 1 - last),
    hiddenAbove: first,
    maxScroll,
  };
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
  /** Extra activity rows unlocked by clicking "more below". */
  const [expandBoost, setExpandBoost] = useState(0);
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
  const blockCountRef = useRef(0);
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
            if (direction < 0) {
              setScrollFromBottom((n) => n + 3);
            } else {
              setScrollFromBottom((n) => {
                const next = Math.max(0, n - 3);
                return next <= 1 ? 0 : next;
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
        setExpandBoost(0);
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

  // Grok-style sticky follow: when pinned to bottom, new blocks stay in view.
  // When the user has scrolled up, keep their anchor by advancing the offset.
  useEffect(() => {
    const prev = blockCountRef.current;
    const next = blocks.length;
    blockCountRef.current = next;
    if (next <= prev) return;
    if (scrollRef.current > 0) {
      setScrollFromBottom((n) => n + (next - prev));
    }
  }, [blocks.length]);

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

  const scrollUp = useCallback(() => {
    setScrollFromBottom((n) => n + 3);
  }, []);
  /** Resume follow mode (Grok: jump to live edge). */
  const followLive = useCallback(() => {
    setScrollFromBottom(0);
    setExpandBoost(0);
  }, []);
  /** Reveal newer content; snap to live edge when close enough. */
  const expandBelow = useCallback(() => {
    setScrollFromBottom((n) => {
      const next = Math.max(0, n - 5);
      return next <= 2 ? 0 : next;
    });
    setExpandBoost((b) => Math.min(48, b + 8));
  }, []);
  const expandAbove = useCallback(() => {
    setScrollFromBottom((n) => n + 5);
    setExpandBoost((b) => Math.min(48, b + 8));
  }, []);

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
        expandBelow();
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

  // Readable column width on large terminals (don't stretch prose edge-to-edge).
  const STATS_W = columns >= 140 ? 34 : columns >= 100 ? 28 : 24;
  const CONTENT_MAX =
    columns >= 180 ? 112 : columns >= 140 ? 100 : columns >= 110 ? 92 : 88;
  const showStats = columns >= 72;
  const showSidebar = columns >= SIDEBAR_MIN_WIDTH && columns < 160;
  const chromePad =
    columns >= 140
      ? Math.max(
          2,
          Math.floor(
            (columns - CONTENT_MAX - (showStats ? STATS_W + 4 : 0)) / 2,
          ),
        )
      : 1;
  const conversationWidth = Math.max(
    24,
    Math.min(
      CONTENT_MAX + 2,
      showSidebar ? columns - SIDEBAR_WIDTH - chromePad : columns - chromePad * 2,
    ),
  );
  const contentWidth = Math.max(16, Math.min(CONTENT_MAX, conversationWidth - 2));

  const budget = Math.max(6, rows - (columns >= 140 ? 14 : 12) + expandBoost);
  const { visible, atBottom, canScrollUp, hiddenBelow, hiddenAbove } = useMemo(
    () => windowBlocks(blocks, budget, scrollFromBottom),
    [blocks, budget, scrollFromBottom],
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

  const showPlanInline = !showSidebar;

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
    <Box flexDirection="column" width={columns} height={rows} paddingX={chromePad > 1 ? 0 : 0}>
      <Box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={chromePad}
        paddingRight={chromePad}
        marginBottom={1}
        width={columns}
      >
        <Box flexDirection="column">
          <Wordmark />
        </Box>
        {showStats ? (
          <StatsPanel
            key={`stats-${statsEpoch}-${tokensOut}-${toolCalls}-${elapsedMs}`}
            stats={sessionStats}
            width={STATS_W}
          />
        ) : null}
      </Box>

      <Box flexDirection="row" flexGrow={1} paddingLeft={chromePad} paddingRight={chromePad}>
        <Box
          flexDirection="column"
          width={conversationWidth}
          paddingRight={1}
        >
          {canScrollUp ? (
            <ScrollCue
              direction="up"
              label={
                hiddenAbove > 0
                  ? `${hiddenAbove} more above`
                  : `scroll (${scrollFromBottom} from bottom)`
              }
              register={(node) => registerScrollCue("more-above", node)}
            />
          ) : null}

          <Box flexGrow={1} flexDirection="column">
            <Activity
              blocks={visible}
              width={contentWidth}
              spinnerFrame={frame}
              expandedIds={expandedIds}
              registerRow={registerRow}
            />
            {!atBottom ? (
              <ScrollCue
                direction="down"
                label={
                  hiddenBelow > 0
                    ? `${hiddenBelow} more below · click to follow`
                    : "follow live"
                }
                register={(node) => registerScrollCue("more-below", node)}
              />
            ) : null}
            <Box marginTop={1}>
              <LifecycleLine
                phase={lifecycle}
                frame={frame}
                width={contentWidth}
              />
            </Box>
          </Box>

          {showPlanInline ? (
            <PlanPane todo={todo} width={contentWidth} />
          ) : null}
          <ApprovalsPane items={approvals} width={contentWidth} />

          {props.interactive ? (
            <Box flexDirection="column" marginTop={1}>
              <PromptBox
                width={contentWidth}
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
              <HintLine width={contentWidth} hints={promptHints} />
            </Box>
          ) : null}
        </Box>

        {showSidebar ? (
          <Box
            flexDirection="column"
            width={SIDEBAR_WIDTH}
            paddingLeft={1}
          >
            <PlanPane todo={todo} width={SIDEBAR_WIDTH - 2} />
          </Box>
        ) : null}
      </Box>

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
