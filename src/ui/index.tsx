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
  ThinkingItem,
  ToolStatus,
  UiState,
} from "./state.js";
export { groupItems, initialUiState, reduceUiEvent } from "./state.js";

export type { ClaiAppProps, RenderShellOptions, ShellApi, ShellHandle } from "./app.js";
export { ClaiApp, renderShell } from "./app.js";

export type { ToolBridgeOptions, ToolPlaneLike } from "./bridge.js";
export {
  createToolPlaneBridge,
  detailFromToolOutput,
  formatHumanBytes,
} from "./bridge.js";

export {
  attachHeadless,
  createHeadlessPrinter,
  formatHeadlessEvent,
  isTuiEnabled,
} from "./headless.js";

export type { SessionLogHandle } from "./session-log.js";
export { attachSessionLog } from "./session-log.js";

export type { LogPrinterOptions } from "./log.js";
export {
  attachLogPrinter,
  createLogPrinter,
  formatTurnSummary,
  resetSgr,
} from "./log.js";

export {
  Activity,
  ApprovalPrompt,
  ApprovalsPane,
  BrandIntro,
  BRAND_INTRO_INTERVAL_MS,
  BRAND_INTRO_TOTAL_TICKS,
  CodeWriteFragment,
  ContextStrip,
  Credit,
  FooterBar,
  HintLine,
  LifecycleLine,
  PlanBlock,
  PlanPane,
  ProgressBar,
  PromptBox,
  SIDEBAR_WIDTH,
  ScrollCue,
  Sidebar,
  SplashFooter,
  StatsPanel,
  ThinkingBlock,
  ToolRowLine,
  VerifyResult,
  Wordmark,
  WorkingLine,
  brandIntroLetterColor,
  deriveLifecycle,
  extractCodeFragment,
  formatCost,
  formatCostPrecise,
  formatDuration,
  formatHomePath,
  formatTokens,
  measureContextStripRows,
  measurePromptRows,
  promptBodyLines,
  shouldPlayBrandIntro,
  toolSigil,
  visiblePromptBodyLines,
} from "./components.js";

export type { FooterHint, LifecyclePhase, Segment } from "./components.js";

export {
  CREDIT,
  LIFECYCLE,
  WORDMARK,
  WORDMARK_LEFT,
  WORDMARK_RIGHT,
  WORDMARK_LARGE,
  chalkLevelToColorLevel,
  colorLevel,
  detectColorLevel,
  detectGlyphs,
  expandWordmarkRow,
  glyph,
  glyphs,
  lifecycleIcon,
  paintText,
  resolve,
  setColorLevel,
  setGlyphs,
  tintHex,
} from "./theme.js";

export type {
  ColorLevel,
  GlyphName,
  GlyphSet,
  LifecycleState,
  ThemeToken,
  WordmarkCell,
} from "./theme.js";

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
