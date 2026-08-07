/**
 * ui/__checks__/render-check — offline verification of the TUI redesign.
 *
 * Renders interactive + working screens into a fake 140×40 TTY (PassThrough),
 * asserts wordmark / lifecycle / strip / density / mouse parser / theme tokens,
 * and exits non-zero on any failure. Safe to run without a real terminal.
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
  CREDIT,
  WORDMARK,
  WORDMARK_LARGE,
  detectColorLevel,
  resolve,
  setColorLevel,
  setGlyphs,
  detectGlyphs,
  LIFECYCLE,
  lifecycleIcon,
} from "../theme.js";
import { formatHeadlessEvent } from "../headless.js";
import { groupItems, initialUiState, reduceUiEvent } from "../state.js";
import {
  brandIntroLetterColor,
  deriveLifecycle,
  extractCodeFragment,
  shouldPlayBrandIntro,
} from "../components.js";

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
        sandboxMode: "workspace",
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

  await settle(280);
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
  assert("brand.wordmark is #E8E8ED", resolve("brand.wordmark") === "#E8E8ED");
  assert("text.primary is #C0C0C8", resolve("text.primary") === "#C0C0C8");
  assert("state.pass is #5FD98A", resolve("state.pass") === "#5FD98A");
  assert("state.fail is #E85555", resolve("state.fail") === "#E85555");
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
  assert("16-level working is yellow", resolve("state.working") === "yellow");
  assert("16-level verify is cyan", resolve("state.verify") === "cyan");
  setColorLevel("truecolor");

  setColorLevel("none");
  assert("NO_COLOR chrome collapses", resolve("brand.wordmark") === undefined);
  assert("NO_COLOR state also undefined (shape only)", resolve("state.pass") === undefined);
  setColorLevel("truecolor");

  // ── lifecycle icons ────────────────────────────────────────────────────────
  assert("working icon", LIFECYCLE.working.icon === "●");
  assert("verify icon", LIFECYCLE.verify.icon === "◐");
  assert("pass icon", lifecycleIcon("pass") === "✓");
  assert("fail icon", lifecycleIcon("fail") === "✗");
  assert("repair icon", lifecycleIcon("repair") === "↻");
  assert("blocked icon", lifecycleIcon("blocked") === "⊘");

  const workingPhase = deriveLifecycle({
    status: { label: "planning next step", level: "info" },
    items: [],
  });
  assert("derive working", workingPhase?.state === "working");

  const verifyPhase = deriveLifecycle({
    status: { label: "verify checks", level: "info" },
    items: [],
  });
  assert("derive verify", verifyPhase?.state === "verify");

  // ── brand intro unit ───────────────────────────────────────────────────────
  assert(
    "intro skips fake stdout",
    shouldPlayBrandIntro({
      interactive: true,
      stdout: { isTTY: true },
      env: {},
    }) === false,
  );
  assert(
    "intro skips CLAI_NO_INTRO",
    shouldPlayBrandIntro({
      interactive: true,
      stdout: process.stdout,
      env: { CLAI_NO_INTRO: "1" },
    }) === false,
  );
  assert(
    "intro letter 0 bright on first reveal",
    brandIntroLetterColor(0, 1) === resolve("brand.wordmark"),
  );
  assert(
    "intro letter 1 hidden before reveal",
    brandIntroLetterColor(1, 1) === undefined,
  );
  assert(
    "large wordmark has 4 rows",
    WORDMARK_LARGE.length === 4,
  );
  assert(
    "extract code fence fragment",
    extractCodeFragment("here\n```ts\nconst x = 1\nconst y = 2\n```")?.includes("const y") === true,
  );

  // streaming reduce: deltas append, done seals
  let streamState = initialUiState();
  streamState = reduceUiEvent(streamState, {
    type: "assistant",
    id: "s1",
    text: "Hel",
    done: false,
  });
  streamState = reduceUiEvent(streamState, {
    type: "assistant",
    id: "s1",
    text: "lo",
    done: false,
  });
  streamState = reduceUiEvent(streamState, {
    type: "assistant",
    id: "s1",
    text: "",
    done: true,
  });
  const streamed = streamState.items.find((i) => i.kind === "assistant");
  assert(
    "streaming appends deltas",
    streamed?.kind === "assistant" &&
      streamed.text === "Hello" &&
      streamed.done === true,
  );

  // chronology defense: same assistant id after a tool must not replaceById above tools
  let chronoState = initialUiState();
  chronoState = reduceUiEvent(chronoState, {
    type: "assistant",
    id: "a",
    text: "hello",
    done: true,
  });
  chronoState = reduceUiEvent(chronoState, {
    type: "tool_call",
    id: "t",
    tool: "read",
    target: "x.ts",
  });
  chronoState = reduceUiEvent(chronoState, {
    type: "assistant",
    id: "a",
    text: "world",
    done: true,
  });
  const chronoKinds = chronoState.items.map((i) => i.kind);
  assert(
    "assistant/tool/assistant chronology",
    chronoKinds.includes("assistant") &&
      chronoKinds.includes("tool") &&
      chronoKinds.join(",") === "assistant,tool,assistant",
    `got ${chronoKinds.join(",")}`,
  );
  const chronoAsst = chronoState.items.filter((i) => i.kind === "assistant");
  assert(
    "post-tool assistant gets ~cont id",
    chronoAsst.length === 2 &&
      chronoAsst[0]?.kind === "assistant" &&
      chronoAsst[0].id === "a" &&
      chronoAsst[0].text === "hello" &&
      chronoAsst[1]?.kind === "assistant" &&
      chronoAsst[1].id === "a~cont-1" &&
      chronoAsst[1].text === "world",
  );

  // thinking reduce: deltas append, done seals; tool_call seals open thinking
  let thinkState = initialUiState();
  thinkState = reduceUiEvent(thinkState, {
    type: "thinking",
    id: "t-think",
    text: "considering",
    done: false,
  });
  thinkState = reduceUiEvent(thinkState, {
    type: "thinking",
    id: "t-think",
    text: " paths",
    done: false,
  });
  thinkState = reduceUiEvent(thinkState, {
    type: "tool_call",
    id: "tw",
    tool: "write",
    target: "architecture.html",
  });
  const thought = thinkState.items.find((i) => i.kind === "thinking");
  assert(
    "thinking appends then seals on tool_call",
    thought?.kind === "thinking" &&
      thought.text === "considering paths" &&
      thought.done === true,
  );

  const writePendingPhase = deriveLifecycle({
    status: { label: "thinking", level: "info" },
    items: thinkState.items,
  });
  assert(
    "pending write surfaces in lifecycle",
    writePendingPhase?.detail === "Writing architecture.html",
    writePendingPhase?.detail,
  );

  {
    const { createToolPlaneBridge, formatHumanBytes } = await import(
      "../bridge.js",
    );
    assert("formatHumanBytes 43061", formatHumanBytes(43061) === "42KB");
    const detailBus = createUiBus();
    const toolResults: Array<{ detail?: string }> = [];
    detailBus.subscribe((e) => {
      if (e.type === "tool_result") toolResults.push(e);
    });
    const bridge = createToolPlaneBridge(detailBus);
    bridge({ type: "tool_call", tool: "write", target: "architecture.html" });
    bridge({
      type: "tool_result",
      tool: "write",
      ok: true,
      target: "architecture.html",
      durationMs: 24,
      output: { path: "architecture.html", ok: true, detail: 43061 },
    });
    assert(
      "bridge write detail is human bytes",
      toolResults[0]?.detail === "42KB",
      toolResults[0]?.detail,
    );
  }

  const thinkHeadless = formatHeadlessEvent({
    type: "thinking",
    id: "th1",
    text: "plan the edit",
    done: true,
  });
  assert(
    "headless thinking shape",
    thinkHeadless === "[think] plan the edit",
    thinkHeadless ?? "null",
  );

  // ── mouse parser ───────────────────────────────────────────────────────────
  const events: Array<{ kind: string; x: number; y: number }> = [];
  const parser = createSgrMouseParser((e) =>
    events.push({ kind: e.kind, x: e.x, y: e.y }),
  );
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

  // ── headless byte-compat smoke (must stay plain / uncolored) ───────────────
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
  assert(
    "headless has no brand",
    !String(toolCall).includes(WORDMARK) && !String(toolCall).includes(CREDIT),
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

  // ── interactive idle (no splash art) ───────────────────────────────────────
  const idle = await renderFrame(120, 30, () => {}, true);
  assert("idle has CLAI wordmark", idle.includes(WORDMARK), idle.slice(0, 200));
  assert("idle has credit", idle.includes(CREDIT));
  assert(
    "idle has no block-art splash",
    !/[▀▄█]{3,}/.test(idle),
    "block glyphs still present",
  );
  assert(
    "idle placeholder",
    idle.includes("Ask anything"),
    "missing Ask anything",
  );
  assert("idle agent Build", /\bBuild\b/.test(idle), "missing Build");
  assert(
    "idle composer hRule chrome",
    idle.includes("─".repeat(8)) || idle.includes("-".repeat(8)),
    "missing composer ── rules",
  );
  assert(
    "idle keybind hints in strip",
    idle.includes("switch agent") && idle.includes("commands"),
  );
  assert(
    "idle footer has cwd or model",
    /gpt-oss|Projects\/clai|P:\/Projects/.test(idle),
    idle.slice(0, 280),
  );

  // ── working screen render (≥120 → plan side column) ────────────────────────
  const working = await renderFrame(140, 40, (bus) => {
    bus.emit({ type: "user", text: "add age verification to signup" });
    bus.emit({
      type: "thinking",
      id: "th-smoke",
      text: "checking the approval seam before edits",
      done: true,
    });
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

  assert("working has CLAI wordmark", working.includes(WORDMARK), working.slice(0, 120));
  assert("working has credit", working.includes(CREDIT), working.slice(0, 120));
  assert(
    "working has thought header",
    working.includes("thought"),
    "missing thinking block",
  );
  assert(
    "working has Working lifecycle",
    working.includes("Working"),
    `len=${working.length} snippet=${JSON.stringify(working.replace(/\s+/g, " ").slice(0, 240))}`,
  );
  assert(
    "working has stats panel",
    working.includes("tokens") && working.includes("tools") && working.includes("cost"),
    "missing stats panel fields",
  );
  assert("working has plan pane", working.includes("plan") || working.includes("Todo") || working.includes("sandbox approval"));
  assert(
    "working has compact token strip or stats",
    /↑20,000|↑20000|tokens/.test(working),
    "missing ↑in or stats tokens",
  );
  assert(
    "working cost on stats",
    working.includes("$0.24") || working.includes("0.24"),
  );
  assert(
    "working strip has scroll/interrupt hints",
    working.includes("interrupt") && working.includes("scroll"),
  );
  assert(
    "working tool verb Read",
    working.includes("Read") && working.includes("edit.ts"),
  );
  assert("working tool verb Grep", working.includes("Grep"));
  assert("working explore group", working.includes("explore"));
  assert(
    "working omits processed badge",
    !working.includes("processed"),
    "done assistant should not show processed · reply",
  );
  assert("working interrupt hint", working.includes("interrupt"));
  assert("working has no Context sidebar heading", !/\bContext\b/.test(working));
  assert(
    "working composer hRule chrome",
    working.includes("─".repeat(8)) || working.includes("-".repeat(8)),
  );

  const narrow = await renderFrame(90, 30, (bus) => {
    bus.emit({ type: "user", text: "hi" });
    bus.emit({
      type: "metrics",
      tokensIn: 100,
      tokensOut: 20,
      contextPct: 1,
      costUsd: 0,
    });
    bus.emit({
      type: "verify",
      label: "unit",
      ok: true,
    });
  });
  assert("narrow has credit", narrow.includes(CREDIT));
  assert(
    "narrow collapses strip essentials",
    narrow.includes(WORDMARK) && (narrow.includes("PASS") || narrow.includes("gpt-oss")),
    narrow.slice(0, 300),
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
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
