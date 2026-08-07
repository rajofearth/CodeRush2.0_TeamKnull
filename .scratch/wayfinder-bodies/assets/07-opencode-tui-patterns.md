# OpenCode TUI — patterns studied (not copied)

Source read: shallow clone of `anomalyco/opencode` at `.scratch/opencode-ref` (sparse — `packages/tui/src` utils, routes, theme assets). Companion to `07-tui-look.md`, which stays the authority on what CLAI's pane looks like.

## What their stack actually is

OpenCode's TUI is **SolidJS on OpenTUI** (`<box>`, `<text>`, `<scrollbox>` intrinsics with `fg`/`backgroundColor` props and a real scroll container), not Ink. Their session view is a route tree (`routes/session/{index,sidebar,permission,question,subagent-footer}.tsx`) with a plugin slot system layered on top.

Consequence for us: the *composition* transfers, the implementation does not. Ink has no scrollbox and re-renders the whole tree each frame, so where they scroll a retained buffer we tail the item list to fit the terminal height. Anything that needs a scrollback viewport (their `util/scroll.ts` acceleration curve, selection, transcript export) is out of scope for CLAI's MVP.

## Patterns worth converging on

- **Sidebar is label/value lines, not a card.** `sidebar.tsx` is a fixed-width (42) panel: bold title, muted session id, muted workspace label, muted share URL, then a footer line. No borders, no boxes — separation comes from a slightly different panel background and padding. CLAI's `ContextStrip` does the same at width 30 with a padded label column, and is dropped entirely below 100 columns rather than squeezed.
- **Color is semantic only.** Their theme JSONs expose a small vocabulary (`text`, `textMuted`, `success`, `borderActive`, `background`, `backgroundPanel`) and components pick from it. We collapsed this to Ink's `dimColor` for secondary and green/red/yellow/cyan for status — no theme abstraction, per the locked look doc.
- **Permission and question are first-class rows in the activity stream**, not modal dialogs (`routes/session/permission.tsx`, `question.tsx` sit alongside the message list). CLAI's `ApprovalPrompt` follows: inline block, decision rendered in place once resolved, so the log stays a single readable chronology.
- **Tool state is a small enum with a structured payload.** `util/tool-display.ts` only reads `structured` metadata once `status !== "pending"`. Same shape as our `tool_call` → `tool_result` pairing: a pending row that mutates in place rather than two log lines.
- **Human-scaled formatting helpers live in `util/`** (`format.ts` duration laddering s → m → h → days). We mirrored this with `formatDuration` / `formatTokens` / `formatCost` in `ui/components.tsx`.
- **Footer/epilogue carries continuation affordances** (`util/presentation.ts` prints session + `opencode -s <id>` on exit). CLAI's analogue is the trace pointer line and `runId` in the strip — our artifact is `trace.html`, not a resumable session.

## Deliberately not taken

- `util/presentation.ts` wordmark and any ANSI logo/splash — brand asset.
- Theme pack (30+ palettes), plugin slot runtime, dialog system, diff viewer, session switcher. All feature surface we have no ticket for.
- Their file/route naming and command vocabulary.

## Where CLAI diverges by design

Our pane carries things theirs does not surface: a `PlanBlock` fed by the verification-gated task graph (rendered only when plan events actually arrive — no invented subagents), a `VerifyResult` block with a pointer to the evidence log, and memory injected/dropped counts in the strip. The `tab agents` footer hint is rendered dim/disabled until the task graph lands.
