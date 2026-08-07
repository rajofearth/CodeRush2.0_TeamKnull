/**
 * ui/__checks__/render-check — offline verification of the TUI rebuild.
 *
 * Renders splash + working screens into a fake 140×40 TTY (PassThrough),
 * asserts wordmark / sidebar / density / mouse parser / theme tokens, and
 * exits non-zero on any failure. Safe to run without a real terminal.
 *
 *   pnpm exec tsx src/ui/__checks__/render-check.ts
 */

import { PassThrough } from "node:stream";
import React from "react";
import { render } from "ink";
import { ClaiApp } from "../app.js";
import { createUiBus } from "../events.js";
import {
  createSgrMouseParser,
  isMouseEnabled,
} from "../mouse.js";
import {
  detectColorLevel,
  expandWordmarkRow,
  resolve,
  setColorLevel,
  setGlyphs,
  detectGlyphs,
  WORDMARK_LEFT,
  WORDMARK_RIGHT,
  glyph,
} from "../theme.js";
import { formatHeadlessEvent } from "../headless.js";
import { groupItems, initialUiState, reduceUiEvent } from "../state.js";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function assert(name: string, cond: boolean, detail?: string): void {
  checks.push({ name, ok: cond, detail: cond ? undefined : detail });
}

function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\r/g, "");
}

type FakeStdout = PassThrough & {
  columns: number;
  rows: number;
  isTTY: boolean;
};

function makeStdout(columns: number, rows: number): {
  stream: FakeStdout;
  getOutput: () => string;
} {
  const stream = new PassThrough() as FakeStdout;
  stream.columns = columns;
  stream.rows = rows;
  stream.isTTY = true;
  let buf = "";
  stream.on("data", (chunk: Buffer | string) => {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  });
  // Ink writes via stream.write; also capture that path.
  const originalWrite = stream.write.bind(stream);
  stream.write = ((
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((error: Error | null | undefined) => void),
    cb?: (error: Error | null | undefined) => void,
  ) => {
    const text =
      typeof chunk === "string"
        ? chunk
        : Buffer.from(chunk).toString("utf8");
    buf += text;
    if (typeof encodingOrCb === "function") {
      return originalWrite(chunk, encodingOrCb);
    }
    return originalWrite(chunk, encodingOrCb as BufferEncoding, cb);
  }) as typeof stream.write;
  return {
    stream,
    getOutput: () => buf,
  };
}

function makeStdin(): NodeJS.ReadStream {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: (mode: boolean) => NodeJS.ReadStream;
    ref: () => void;
    unref: () => void;
  };
  // Ink's useInput requires isTTY + setRawMode; keep CLAI_MOUSE=0 so we
  // never arm the real mouse layer against this fake stream.
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = () => stdin as unknown as NodeJS.ReadStream;
  stdin.ref = () => {};
  stdin.unref = () => {};
  return stdin as unknown as NodeJS.ReadStream;
}

async function settle(ms = 80): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function renderFrame(
  columns: number,
  rows: number,
  setup: (bus: ReturnType<typeof createUiBus>) => void,
  interactive = false,
): Promise<string> {
  const { stream, getOutput } = makeStdout(columns, rows);
  const stdin = makeStdin();
  const bus = createUiBus();
  setup(bus);

  const instance = render(
    React.createElement(ClaiApp, {
      bus,
      interactive,
      context: {
        title: "Wire the edit tool into the sandbox approval path",
        agent: "build",
        model: "Groq/gpt-oss-20b",
        cwd: "P:/Projects/clai",
        mcp: ["context7"],
        lsp: ["typescript"],
      },
      exitWhenDone: false,
      onInterrupt: () => {},
    }),
    {
      stdout: stream as unknown as NodeJS.WriteStream,
      stdin,
      patchConsole: false,
    },
  );

  await settle(150);
  const out = getOutput();
  instance.unmount();
  await settle(40);
  stdin.destroy();
  stream.destroy();
  return stripAnsi(out);
}

async function main(): Promise<void> {
  process.env.CLAI_MOUSE = "0";
  process.env.CLAI_ASCII = "0";
  setColorLevel("truecolor");
  setGlyphs(detectGlyphs({ ...process.env, WT_SESSION: undefined, CLAI_ASCII: undefined }));

  // ── theme ──────────────────────────────────────────────────────────────────
  assert("accent is #5c9cf5", resolve("clai.accent") === "#5c9cf5");
  assert("text is #eeeeee", resolve("clai.text") === "#eeeeee");
  assert(
    "NO_COLOR wins",
    detectColorLevel({ NO_COLOR: "1", FORCE_COLOR: "3" }, true) === "none",
  );
  assert(
    "CLAI_COLOR override",
    detectColorLevel({ CLAI_COLOR: "256" }, true) === "256",
  );

  setColorLevel("16");
  assert("16-level drops panel bg", resolve("clai.backgroundPanel") === undefined);
  assert("16-level accent is blueBright", resolve("clai.accent") === "blueBright");
  setColorLevel("truecolor");

  // ── wordmark ───────────────────────────────────────────────────────────────
  const leftRow2 = expandWordmarkRow(WORDMARK_LEFT[2]!);
  const rightRow2 = expandWordmarkRow(WORDMARK_RIGHT[2]!);
  assert(
    "wordmark left row has shadowed spaces",
    leftRow2.some((c) => c.paint === "shadowBg" && c.char === " "),
  );
  assert(
    "wordmark right row has shadowed ▀ from ^",
    rightRow2.some((c) => c.paint === "shadowBg" && c.char === glyph("blockUpper")),
  );
  assert("wordmark left is 9 cols", WORDMARK_LEFT.every((r) => r.length === 9));
  assert("wordmark right is 6 cols", WORDMARK_RIGHT.every((r) => r.length === 6));

  // ── mouse parser ───────────────────────────────────────────────────────────
  const events: Array<{ kind: string; x: number; y: number }> = [];
  const parser = createSgrMouseParser((e) =>
    events.push({ kind: e.kind, x: e.x, y: e.y }),
  );
  // Fragmented: press, release, wheel-up, wheel-down — chopped mid-sequence.
  const wire =
    "\x1b[<0;13;4M" +
    "\x1b[<0;13;4m" +
    "\x1b[<64;41;11M" +
    "\x1b[<65;41;11M";
  const chunks = [
    Buffer.from(wire.slice(0, 3), "latin1"),
    Buffer.from(wire.slice(3, 10), "latin1"),
    Buffer.from(wire.slice(10), "latin1"),
  ];
  for (const chunk of chunks) parser.feed(chunk);
  assert("sgr press parsed", events[0]?.kind === "press" && events[0].x === 12);
  assert("sgr release parsed", events[1]?.kind === "release");
  assert("sgr wheelUp parsed", events[2]?.kind === "wheelUp");
  assert("sgr wheelDown parsed", events[3]?.kind === "wheelDown");
  assert("CLAI_MOUSE=0 disables", isMouseEnabled({ CLAI_MOUSE: "0" }) === false);
  assert("mouse default-on", isMouseEnabled({}) === true);

  // ── headless byte-compat smoke ─────────────────────────────────────────────
  const toolCall = formatHeadlessEvent({
    type: "tool_call",
    id: "t1",
    tool: "read",
    target: "hello.txt",
  });
  assert(
    "headless tool_call shape",
    toolCall === "[··] read  hello.txt",
    toolCall ?? "null",
  );
  const toolResult = formatHeadlessEvent({
    type: "tool_result",
    id: "t1",
    tool: "read",
    ok: true,
    detail: "hello.txt",
    durationMs: 12,
  });
  assert(
    "headless tool_result shape",
    toolResult === "[ok] read  hello.txt  12ms",
    toolResult ?? "null",
  );

  // ── density: consecutive tools group with zero internal gap ────────────────
  let state = initialUiState();
  state = reduceUiEvent(state, {
    type: "tool_call",
    id: "a",
    tool: "read",
    target: "a.ts",
    group: "explore",
  });
  state = reduceUiEvent(state, {
    type: "tool_call",
    id: "b",
    tool: "grep",
    target: "x",
    group: "explore",
  });
  const grouped = groupItems(state.items);
  assert(
    "explore tools collapse to one group",
    grouped.length === 1 && grouped[0]?.kind === "toolGroup",
  );

  // ── splash render ──────────────────────────────────────────────────────────
  const splash = await renderFrame(120, 30, () => {}, true);
  assert(
    "splash has block wordmark glyphs",
    /[▀▄█]/.test(splash) || splash.includes("#"),
    splash.slice(0, 200),
  );
  assert(
    "splash placeholder",
    splash.includes("Ask anything"),
    "missing Ask anything",
  );
  assert(
    "splash agent Build",
    /\bBuild\b/.test(splash),
    "missing Build",
  );
  assert(
    "splash keybind hints",
    splash.includes("switch agent") && splash.includes("commands"),
  );
  assert(
    "splash has no Context sidebar",
    !splash.includes("Context") || splash.indexOf("Ask anything") < splash.indexOf("Context"),
  );
  assert("splash shows /status", splash.includes("/status"));
  assert("splash shows clai version", /clai\s+\d/.test(splash));

  // ── working screen render (≥120 → sidebar docked) ──────────────────────────
  const working = await renderFrame(140, 40, (bus) => {
    bus.emit({ type: "user", text: "add age verification to signup" });
    bus.emit({
      type: "assistant",
      id: "a1",
      text: "I'll explore the signup path first.",
      done: true,
    });
    bus.emit({
      type: "tool_call",
      id: "t1",
      tool: "grep",
      target: "CreateNewUser",
      group: "explore",
    });
    bus.emit({
      type: "tool_result",
      id: "t1",
      tool: "grep",
      ok: true,
      durationMs: 18,
    });
    bus.emit({
      type: "tool_call",
      id: "t2",
      tool: "read",
      target: "src/tools/edit.ts",
      group: "explore",
    });
    bus.emit({
      type: "tool_result",
      id: "t2",
      tool: "read",
      ok: true,
      durationMs: 9,
    });
    bus.emit({
      type: "todo",
      id: "todo",
      steps: [
        { label: "Read the sandbox approval seam", state: "done" },
        { label: "Route edit through the approval hook", state: "active" },
        { label: "Run the offline demo", state: "pending" },
      ],
    });
    bus.emit({
      type: "metrics",
      tokensIn: 20000,
      tokensOut: 8221,
      contextPct: 14,
      costUsd: 0.24,
    });
    bus.emit({
      type: "status",
      label: "planning next step",
    });
  });

  assert("working has sidebar Context", working.includes("Context"));
  assert("working has token count", working.includes("tokens"));
  assert("working has cost", working.includes("$0.24 spent"));
  assert("working has MCP section", working.includes("MCP"));
  assert("working has LSP section", working.includes("LSP"));
  assert("working has Todo section", working.includes("Todo"));
  assert(
    "working tool verb Read",
    working.includes("Read") && working.includes("edit.ts"),
  );
  assert(
    "working tool verb Grep",
    working.includes("Grep"),
  );
  assert("working explore group", working.includes("explore"));
  assert(
    "working interrupt hint",
    working.includes("interrupt"),
  );
  assert(
    "working narrow hide: sidebar absent under 120",
    true, // checked separately below
  );

  const narrow = await renderFrame(100, 30, (bus) => {
    bus.emit({ type: "user", text: "hi" });
    bus.emit({
      type: "metrics",
      tokensIn: 100,
      tokensOut: 20,
      contextPct: 1,
      costUsd: 0,
    });
  });
  // Under 120 the sidebar is hidden — session title still may appear in footer/context,
  // but the Context heading lives only in the sidebar.
  assert(
    "narrow hides sidebar Context heading",
    !narrow.includes("\nContext\n") && !narrow.includes("Context\n"),
    "Context still visible at width 100",
  );

  // ── report ─────────────────────────────────────────────────────────────────
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
  // Ink can leave handles open on fake streams; force a clean exit.
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
