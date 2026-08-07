/**
 * ui/app — CLAI ADE shell: header, scrollable activity, context strip, input, footer.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { UiBus, UiEvent } from "./events.js";
import { createUiBus } from "./events.js";
import {
  groupItems,
  initialUiState,
  reduceUiEvent,
  type ActivityItem,
  type RenderBlock,
  type RunContext,
  type UiState,
} from "./state.js";
import {
  Activity,
  ContextStrip,
  Footer,
  Header,
  InputLine,
  StatusLine,
  type Shortcut,
} from "./components.js";

const STRIP_MIN_WIDTH = 100;
const STRIP_WIDTH = 30;

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
      return 2;
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
  // Build from bottom, then skip `scrollFromBottom` blocks upward.
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
  // Re-fit slice to budget from the end of the slice.
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
  const { columns, rows } = useTerminalSize();
  const [state, setState] = useState<UiState>(() =>
    initialUiState(props.context),
  );
  const [frame, setFrame] = useState(0);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [scrollFromBottom, setScrollFromBottom] = useState(0);
  const [busy, setBusy] = useState(false);
  const interrupt = useRef(props.onInterrupt);
  interrupt.current = props.onInterrupt;
  const onSubmit = useRef(props.onSubmit);
  onSubmit.current = props.onSubmit;

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

  const spinning = state.status != null && exitCode == null;
  useEffect(() => {
    if (!spinning) return;
    const timer = setInterval(() => setFrame((n) => n + 1), 90);
    return () => clearInterval(timer);
  }, [spinning]);

  useEffect(() => {
    if (exitCode == null) return;
    process.exitCode = exitCode;
    if (props.exitWhenDone === false) return;
    const timer = setTimeout(() => exit(), 60);
    return () => clearTimeout(timer);
  }, [exitCode, exit, props.exitWhenDone]);

  useInput(
    (ch, key) => {
      if (key.escape) {
        interrupt.current?.();
        return;
      }
      // Scroll: PgUp / PgDn / Ctrl+U / Ctrl+D
      if (key.pageUp || (key.ctrl && ch === "u")) {
        setScrollFromBottom((n) => n + 5);
        return;
      }
      if (key.pageDown || (key.ctrl && ch === "d")) {
        setScrollFromBottom((n) => Math.max(0, n - 5));
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
        setInput((v) => v.slice(0, -1));
        return;
      }
      if (ch && !key.ctrl && !key.meta) {
        setInput((v) => v + ch);
      }
    },
    { isActive: true },
  );

  const showStrip = columns >= STRIP_MIN_WIDTH;
  const mainWidth = Math.max(
    30,
    (showStrip ? columns - STRIP_WIDTH : columns) - 2,
  );

  const blocks = useMemo(() => groupItems(state.items), [state.items]);
  const budget = Math.max(4, rows - 10);
  const { visible, atBottom, canScrollUp } = useMemo(
    () => windowBlocks(blocks, budget, scrollFromBottom),
    [blocks, budget, scrollFromBottom],
  );

  const shortcuts: Shortcut[] = [
    { key: "esc", label: "interrupt", disabled: !props.onInterrupt },
    { key: "pgup/dn", label: "scroll", disabled: false },
    { key: "enter", label: "send", disabled: !props.interactive || busy },
    { key: "ctrl+c", label: "quit", disabled: false },
  ];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        title={state.context.title ?? "session"}
        metrics={state.metrics}
        width={columns - 2}
      />
      <Box flexDirection="row">
        <Box flexDirection="column" width={mainWidth}>
          {canScrollUp ? (
            <Text dimColor>
              ↑ scroll ({scrollFromBottom} from bottom)
            </Text>
          ) : null}
          <Activity blocks={visible} width={mainWidth} />
          {!atBottom ? <Text dimColor>↓ more below</Text> : null}
          <StatusLine
            status={exitCode == null ? state.status : null}
            frame={frame}
            width={mainWidth}
          />
        </Box>
        {showStrip ? (
          <ContextStrip
            context={state.context}
            metrics={state.metrics}
            width={STRIP_WIDTH}
          />
        ) : null}
      </Box>
      {props.interactive ? (
        <Box marginTop={1}>
          <InputLine
            value={input}
            placeholder={busy ? "working…" : "ask clai…  (pgup/pgdn scroll)"}
            readOnly={busy}
            width={columns - 4}
          />
        </Box>
      ) : state.context.tracePath ? (
        <Box marginTop={1}>
          <Text dimColor>{`trace ${state.context.tracePath}`}</Text>
        </Box>
      ) : null}
      <Footer context={state.context} shortcuts={shortcuts} width={columns - 2} />
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
