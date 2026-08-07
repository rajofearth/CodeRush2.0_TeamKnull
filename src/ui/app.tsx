/**
 * ui/app — CLAI ADE shell: splash home, working screen, alt-buffer, mouse.
 *
 * Layout follows assets/23-visual-language.md. Terminal modes (alt screen +
 * SGR mouse) follow assets/22-renderer-decision.md and tear down on exit.
 */

import { createRequire } from "node:module";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { DOMElement } from "ink";
import type { UiBus, UiEvent } from "./events.js";
import { createUiBus } from "./events.js";
import {
  groupItems,
  initialUiState,
  reduceUiEvent,
  type ActivityItem,
  type PlanItem,
  type RenderBlock,
  type RunContext,
  type UiState,
} from "./state.js";
import {
  Activity,
  FooterBar,
  HintLine,
  PromptBox,
  SIDEBAR_WIDTH,
  Sidebar,
  SplashFooter,
  Wordmark,
  WorkingLine,
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
import { glyphs, resolve } from "./theme.js";

const SIDEBAR_MIN_WIDTH = 120;
const SPLASH_PROMPT_WIDTH = 44;
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
    case "assistant":
      return 2 + Math.ceil(item.text.length / 70);
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
): { visible: RenderBlock[]; atBottom: boolean; canScrollUp: boolean } {
  if (blocks.length === 0) {
    return { visible: [], atBottom: true, canScrollUp: false };
  }
  const fromBottom: RenderBlock[] = [];
  let used = 0;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    used += blockHeight(blocks[i]!);
    if (used > budget && fromBottom.length > 0) break;
    fromBottom.unshift(blocks[i]!);
  }
  const start = Math.max(0, blocks.length - fromBottom.length - scrollFromBottom);
  const end = Math.max(fromBottom.length, blocks.length - scrollFromBottom);
  const slice = blocks.slice(start, end);
  let u = 0;
  const fitted: RenderBlock[] = [];
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    u += blockHeight(slice[i]!);
    if (u > budget && fitted.length > 0) break;
    fitted.unshift(slice[i]!);
  }
  return {
    visible: fitted,
    atBottom: scrollFromBottom <= 0,
    canScrollUp: start > 0 || scrollFromBottom > 0,
  };
}

function latestTodo(items: ActivityItem[]): PlanItem | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    if (item.kind === "plan" && item.variant === "todo") return item;
  }
  // Fall back to the most recent plan so the sidebar has something to show.
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    if (item.kind === "plan") return item;
  }
  return null;
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

  // Alt screen + mouse — only on the real process TTY. Custom streams
  // (render-check PassThroughs) skip terminal modes entirely.
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
            // direction -1 = wheel up → older content; +1 = toward bottom.
            setScrollFromBottom((n) =>
              direction < 0 ? n + 3 : Math.max(0, n - 3),
            );
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
      if (event.type === "status") {
        if (event.done) setBusy(false);
        else if (event.label && !event.sticky) setBusy(true);
      }
      if (event.type === "user") {
        setScrollFromBottom(0);
      }
    });
    props.onReady?.({
      emit: (event) => props.bus.emit(event),
      done: (code = 0) => setExitCode(code),
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sticky-bottom: when pinned, stay pinned; when scrolled up, keep the same
  // anchor by advancing scrollFromBottom as new blocks append.
  const blocks = useMemo(() => groupItems(state.items), [state.items]);
  useEffect(() => {
    const prev = blockCountRef.current;
    const next = blocks.length;
    blockCountRef.current = next;
    if (next <= prev) return;
    if (scrollRef.current > 0) {
      setScrollFromBottom((n) => n + (next - prev));
    }
  }, [blocks.length]);

  const spinning = state.status != null && exitCode == null;
  useEffect(() => {
    if (!spinning) return;
    const timer = setInterval(
      () => setFrame((n) => n + 1),
      glyphs().spinnerIntervalMs,
    );
    return () => clearInterval(timer);
  }, [spinning]);

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
    setScrollFromBottom((n) => n + 5);
  }, []);
  const scrollDown = useCallback(() => {
    setScrollFromBottom((n) => Math.max(0, n - 5));
  }, []);

  useInput(
    (ch, key) => {
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
      // Mouse CSI that slips past the stdin filter must never enter the prompt.
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

  const showSidebar = columns >= SIDEBAR_MIN_WIDTH;
  const conversationWidth = Math.max(
    24,
    showSidebar ? columns - SIDEBAR_WIDTH - 1 : columns,
  );
  // Spec: 1 col left pad, 2 cols right pad inside the conversation column.
  const contentWidth = Math.max(16, conversationWidth - 3);

  const budget = Math.max(4, rows - 12);
  const { visible, atBottom, canScrollUp } = useMemo(
    () => windowBlocks(blocks, budget, scrollFromBottom),
    [blocks, budget, scrollFromBottom],
  );

  const isSplash =
    props.interactive === true &&
    state.items.length === 0 &&
    exitCode == null &&
    !busy;

  const agentLabel = titleCaseAgent(state.context.agent);
  const { model, provider } = splitModel(state.context.model);
  const todo = latestTodo(state.items);
  const progressFraction =
    state.metrics.contextPct != null
      ? Math.min(1, Math.max(0, state.metrics.contextPct / 100))
      : busy || state.status
        ? 0.35
        : 0;

  const interruptMode: "armed" | "confirm" | null =
    props.onInterrupt && (busy || state.status != null)
      ? Date.now() < escArmedUntil
        ? "confirm"
        : "armed"
      : null;

  const footerHints: FooterHint[] = [
    ...(interruptMode
      ? [{ id: "interrupt", key: "esc", label: interruptMode === "confirm" ? "again to interrupt" : "interrupt" }]
      : []),
    { id: "scroll", key: "pgup/dn", label: "scroll" },
  ];

  hintActions.current.set("interrupt", () => requestInterrupt());
  hintActions.current.set("scroll", () => scrollUp());

  const registerRow = useCallback((id: string, node: DOMElement | null) => {
    if (!node) {
      hitRegistry.current.unregister(`tool:${id}`);
      return;
    }
    hitRegistry.current.register(`tool:${id}`, node, () => toggleExpand(id));
  }, [toggleExpand]);

  const registerHint = useCallback((id: string, node: DOMElement | null) => {
    if (!node) {
      hitRegistry.current.unregister(`hint:${id}`);
      return;
    }
    hitRegistry.current.register(`hint:${id}`, node, () => {
      hintActions.current.get(id)?.();
    });
  }, []);

  const promptHints = [
    { key: "tab", label: "switch agent" },
    { key: "ctrl+p", label: "commands" },
  ];

  if (isSplash) {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <Box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
          <Wordmark />
          <Box marginTop={1}>
            <PromptBox
              width={SPLASH_PROMPT_WIDTH}
              value={input}
              placeholder={placeholderFor(placeholderTick)}
              focused={!busy}
              agent={agentLabel}
              model={model}
              provider={provider}
              showCaret={!busy && input.length > 0}
            />
          </Box>
          <Box width={SPLASH_PROMPT_WIDTH} marginTop={0}>
            <HintLine width={SPLASH_PROMPT_WIDTH} hints={promptHints} />
          </Box>
        </Box>
        <SplashFooter
          width={columns}
          cwd={state.context.cwd}
          mcpCount={state.context.mcp.length}
          version={CLAI_VERSION}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexDirection="row" flexGrow={1}>
        <Box
          flexDirection="column"
          width={conversationWidth}
          paddingLeft={1}
          paddingRight={2}
        >
          {canScrollUp ? (
            <Text color={resolve("clai.textFaint")}>
              {`↑ scroll (${scrollFromBottom} from bottom)`}
            </Text>
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
              <Text color={resolve("clai.textFaint")}>↓ more below</Text>
            ) : null}
            <Box marginTop={1}>
              <WorkingLine
                status={exitCode == null ? state.status : null}
                agent={agentLabel}
                model={model}
                frame={frame}
                width={contentWidth}
              />
            </Box>
          </Box>
          {props.interactive ? (
            <Box flexDirection="column" marginTop={1}>
              <PromptBox
                width={contentWidth}
                value={input}
                placeholder={
                  busy
                    ? "working…"
                    : placeholderFor(placeholderTick)
                }
                focused={!busy}
                agent={agentLabel}
                model={model}
                provider={provider}
                showCaret={!busy && input.length > 0}
              />
              <HintLine width={contentWidth} hints={promptHints} />
            </Box>
          ) : state.context.tracePath ? (
            <Box marginTop={1}>
              <Text color={resolve("clai.textMuted")}>
                {`trace ${state.context.tracePath}`}
              </Text>
            </Box>
          ) : null}
        </Box>
        {showSidebar ? (
          <Sidebar
            context={state.context}
            metrics={state.metrics}
            todo={todo}
            height={Math.max(8, rows - 1)}
            version={CLAI_VERSION}
          />
        ) : null}
      </Box>
      <FooterBar
        width={columns}
        progress={progressFraction}
        interrupt={interruptMode}
        hints={footerHints}
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
  const ready = new Promise<ShellApi>((resolve) => {
    const instance = render(
      <ClaiApp
        bus={bus}
        context={opts.context}
        interactive={opts.interactive}
        onSubmit={opts.onSubmit}
        onInterrupt={opts.onInterrupt}
        onReady={resolve}
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
