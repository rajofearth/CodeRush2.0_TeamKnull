/**
 * ui-glass — standalone Ink pane for `clai glass`.
 * Sibling of the main ADE TUI; reuses theme.ts only.
 */

export {
  renderGlassPane,
  initialGlassState,
  reduceGlassEvent,
  emptyStages,
  type GlassState,
  type RenderGlassOptions,
} from "./app.js";

export {
  formatStageSummary,
  type GlassSessionStats,
  type StageRow,
  type StageRowState,
} from "./model.js";
