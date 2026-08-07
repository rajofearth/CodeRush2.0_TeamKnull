/**
 * ui/app — the CLAI shell: header, activity column, optional context strip,
 * status line, footer. One dark dense pane, OpenCode/Pi idiom.
 *
 * Producers drive it through a `UiBus`; nothing here knows about tools,
 * adapters or the sandbox.
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

/** Below this the context strip is dropped rather than squeezed. */
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

/** Rough printed height, used only to decide how much scrollback to keep. */
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

function tailToFit(blocks: RenderBlock[], budget: number): RenderBlock[] {
  if (budget <= 0) return blocks.slice(-1);
  let used = 0;
  const kept: RenderBlock[] = [];
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    used += blockHeight(blocks[i]!);
    if (used > budget && kept.length > 0) break;
    kept.unshift(blocks[i]!);
  }
  return kept;
}

export type ShellApi = {
  emit: (event: UiEvent) => void;
  /** Finish the run: stops the spinner, then unmounts after a paint. */
  done: (exitCode?: number) => void;
};

export type ClaiAppProps = {
  bus: UiBus;
  /** Seed values so the first frame is not empty. */
  context?: Partial<RunContext>;
  /** Interactive chat input (future); demo/run render a read-only prompt. */
  interactive?: boolean;
  onInterrupt?: () => void;
  onReady?: (api: ShellApi) => void;
  /** Unmount when `done()` is called. */
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
  const interrupt = useRef(props.onInterrupt);
  interrupt.current = props.onInterrupt;

  useEffect(() => {
    const unsubscribe = props.bus.subscribe((event) => {
      setState((prev) => reduceUiEvent(prev, event));
    });
    props.onReady?.({
      emit: (event) => props.bus.emit(event),
      done: (code = 0) => setExitCode(code),
    });
    return unsubscribe;
    // Mount-only: the bus identity is stable for a run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spinner ticks only while there is something to spin for.
  const busy = state.status != null && exitCode == null;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setFrame((n) => n + 1), 90);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (exitCode == null) return;
    process.exitCode = exitCode;
    if (props.exitWhenDone === false) return;
    const timer = setTimeout(() => exit(), 60);
    return () => clearTimeout(timer);
  }, [exitCode, exit, props.exitWhenDone]);

  useInput(
    (_input, key) => {
      if (key.escape) interrupt.current?.();
    },
    { isActive: Boolean(props.onInterrupt) },
  );

  const showStrip = columns >= STRIP_MIN_WIDTH;
  const mainWidth = Math.max(
    30,
    (showStrip ? columns - STRIP_WIDTH : columns) - 2,
  );

  const blocks = useMemo(() => groupItems(state.items), [state.items]);
  const visible = useMemo(
    () => tailToFit(blocks, Math.max(4, rows - 8)),
    [blocks, rows],
  );

  const shortcuts: Shortcut[] = [
    { key: "esc", label: "interrupt", disabled: !props.onInterrupt },
    { key: "tab", label: "agents", disabled: true },
    { key: "ctrl+p", label: "commands", disabled: true },
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
          <Activity blocks={visible} width={mainWidth} />
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
      {props.interactive || state.context.tracePath ? (
        <Box marginTop={1}>
          {props.interactive ? (
            <InputLine value="" placeholder="ask clai…" width={columns - 4} />
          ) : (
            <Text dimColor>
              {state.context.tracePath
                ? `trace ${state.context.tracePath}`
                : ""}
            </Text>
          )}
        </Box>
      ) : null}
      <Footer context={state.context} shortcuts={shortcuts} width={columns - 2} />
    </Box>
  );
}

export type RenderShellOptions = {
  context?: Partial<RunContext>;
  interactive?: boolean;
  onInterrupt?: () => void;
  bus?: UiBus;
};

export type ShellHandle = ShellApi & {
  bus: UiBus;
  waitUntilExit: () => Promise<void>;
};

/**
 * Mount the shell and resolve once React has handed back the push API, so
 * callers can start emitting immediately after `await`.
 */
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
        onInterrupt={opts.onInterrupt}
        onReady={resolve}
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
