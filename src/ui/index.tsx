/**
 * ui — CLAI's primary human surface.
 *
 * `renderShell()` mounts the Ink ADE pane; `attachHeadless()` renders the same
 * `UiBus` stream as plain lines when stdout is not a TTY (or CLAI_NO_TUI=1).
 * Producers only ever touch `UiBus.emit`.
 */

export type {
  PlanStep,
  PlanStepState,
  UiBus,
  UiEvent,
  UiEventType,
  UiLevel,
} from "./events.js";
export { createUiBus, nextEventId } from "./events.js";

export type {
  ActivityItem,
  RenderBlock,
  RunContext,
  RunMetrics,
  ToolStatus,
  UiState,
} from "./state.js";
export { groupItems, initialUiState, reduceUiEvent } from "./state.js";

export type { ClaiAppProps, RenderShellOptions, ShellApi, ShellHandle } from "./app.js";
export { ClaiApp, renderShell } from "./app.js";

export type { ToolBridgeOptions, ToolPlaneLike } from "./bridge.js";
export { createToolPlaneBridge } from "./bridge.js";

export {
  attachHeadless,
  createHeadlessPrinter,
  formatHeadlessEvent,
  isTuiEnabled,
} from "./headless.js";

export {
  Activity,
  ApprovalPrompt,
  FooterBar,
  HintLine,
  PlanBlock,
  ProgressBar,
  PromptBox,
  SIDEBAR_WIDTH,
  Sidebar,
  SplashFooter,
  ToolRowLine,
  VerifyResult,
  Wordmark,
  WorkingLine,
  formatCost,
  formatDuration,
  formatTokens,
  toolSigil,
} from "./components.js";

export type { FooterHint, Segment } from "./components.js";

export {
  colorLevel,
  detectColorLevel,
  detectGlyphs,
  expandWordmarkRow,
  glyph,
  glyphs,
  resolve,
  setColorLevel,
  setGlyphs,
  tintHex,
  WORDMARK_LEFT,
  WORDMARK_RIGHT,
} from "./theme.js";

export type { ColorLevel, GlyphName, GlyphSet, ThemeToken, WordmarkCell } from "./theme.js";

export {
  armMouse,
  createHitRegistry,
  createSgrMouseParser,
  enterAltScreen,
  isMouseEnabled,
  measureAbsolute,
  registerRestore,
} from "./mouse.js";

export type { Box, HitRegistry, MouseEvent, MouseEventKind, MouseHandlers } from "./mouse.js";
