# OpenCode TUI — Patterns Worth Stealing (for CLAI's Ink TUI)

Implementation-level companion to `07-tui-look.md` (which locks the *look*). This file records
what OpenCode actually does in code and translates it into an Ink component/event plan.

Source read: `anomalyco/opencode` @ branch `dev`, sparse checkout at `.scratch/opencode-ref`
(gitignored). Packages checked out: `packages/tui`, `packages/session-ui`, `packages/app`.
Pi cross-check: `badlogic/pi-mono` `packages/tui` + `packages/coding-agent` (read via API).

---

## 1. The real stack (don't assume)

| Project | Renderer | Notes |
|---|---|---|
| OpenCode TUI | **SolidJS + OpenTUI** (`@opentui/core`, `@opentui/solid`, `@opentui/keymap`), Bun runtime | Not Ink, not React, and no longer the old Go/Bubbletea TUI. Custom intrinsics: `<box>`, `<text>`, `<span>`, `<scrollbox>`, `<code>`, `<markdown>`, `<diff>`, `<textarea>`, `<spinner>`, `<line_number>` |
| OpenCode web/desktop | Solid again, `packages/session-ui` | Same part/tool model rendered as DOM. Confirms the *data* model is renderer-independent — that's the transferable part. |
| Pi | **Custom differential-rendering TUI lib** (`@earendil-works/pi-tui`), no framework | Primitives only: `box`, `v-stack`, `h-stack`, `text`, `truncated-text`, `markdown`, `scroll-view`, `select-list`, `loader`, `editor`, `spacer` |
| CLAI | **Ink + React 18** (already in `package.json`) | We keep Ink. |

**Takeaway:** the layout tree is Flexbox in all three (OpenTUI and Ink both do flex box/text).
Porting the *structure* is realistic; porting code is not — the JSX intrinsics differ completely.

Two things OpenTUI gives them that Ink does **not**, and which we must plan around:

1. **A real scrollback viewport** (`<scrollbox stickyScroll stickyStart="bottom">`) with scrollbars,
   mouse wheel acceleration, and `scrollTo`/`scrollBy`. Ink has no scroll container — it repaints a
   full frame. CLAI must either cap rendered history (windowing) or accept terminal-native scrollback.
2. **Mouse events** (`onMouseOver`/`onMouseUp`) driving hover highlight and click-to-expand on
   every tool row. Ink has no mouse. **CLAI's expand/collapse must be keyboard-driven.**

---

## 2. Event / data model (the genuinely reusable idea)

OpenCode's TUI is a **pure projection of a normalized store fed by a server event stream**. There is
no UI-owned state machine for the conversation.

`packages/tui/src/context/sync.tsx` holds one Solid store, roughly:

```ts
{
  session:        Session[]
  session_status: { [sessionID]: SessionStatus }   // idle | working | retry
  message:        { [sessionID]: Message[] }        // role: user | assistant
  part:           { [messageID]: Part[] }           // the activity stream
  permission:     { [sessionID]: PermissionRequest[] }
  question:       { [sessionID]: QuestionRequest[] }
  todo:           { [sessionID]: Todo[] }
  lsp: LspStatus[]; mcp: { [k]: McpStatus }; provider: Provider[]; vcs, config, agent, command
}
```

`packages/tui/src/context/event.ts` is ~30 lines: subscribe to a server SSE-ish stream, and
`event.on("message.part.updated", …)` / `on("session.status", …)` dispatch by `type`. Everything
reactive flows from there.

**The key structural decision: a message is a list of typed `Part`s, and the renderer is a
part-type → component map.**

```ts
const PART_MAPPING = { text: TextPart, tool: ToolPart, reasoning: ReasoningPart }
```

Other part types seen in the stream: `file` (attachments on user messages), `compaction`
(renders as a centered `── Compaction ──` rule), plus `synthetic` / `ignored` boolean flags on text
parts so injected context never shows up in the UI.

A `ToolPart` carries a discriminated `state`:

```
state.status: "pending" | "running" | "completed" | "error"
state.input, state.metadata (tool-specific, streams live), state.output, state.error, state.title, state.time
```

This one shape is why the same row can render a spinner, then a result, then an error, without any
per-tool lifecycle code. **Adopt this verbatim in concept for CLAI.**

---

## 3. How tool calls render

`routes/session/index.tsx` (2725 lines — the whole activity stream lives here) has exactly two
tool presentations, and every tool picks one based on whether it has rich output yet:

### `InlineTool` — the one-line row (the default)

```
   ✓  Read src/foo.ts [offset=10]
   ✱  Grep "TODO" in src/ (12 matches)
   $  pnpm test
   ←  Edit src/bar.ts
   →  Read …            ⚙  genericTool [a=1, b=2]
```

- `paddingLeft={3}`, fixed 2-col icon gutter (`INLINE_TOOL_ICON_WIDTH = 2`), then flexible text.
- **Pending state renders `~ Reading file…`** (a per-tool human verb), not the final label. Once
  `state.input` is populated the row flips to the real label. Nice: the row never appears empty.
- Icon vocabulary (ASCII/simple unicode, no nerd fonts): `→` read, `←` write/edit, `✱` glob/grep,
  `$` bash, `%` webfetch/patch, `◈` websearch, `⚙` generic/todo, `✓` done task, `│` running task,
  `✗` failed, `▣` assistant-message footer.
- **Colors are status, not decoration:** `theme.warning` when this call is what a pending permission
  is blocking on, `theme.error` on failure, `theme.textMuted` once complete, `theme.text` while live.
- **Denied calls render struck-through** (`TextAttributes.STRIKETHROUGH`) rather than being removed.
  Detected by string-matching the error (`"rejected permission"`, `"user dismissed"`, …).
- Errors collapse to the row; clicking expands the full error underneath.
- Sub-detail lines hang off the row with `↳`: `↳ Loaded path/x.ts`, `↳ Grep "…"`, `↳ 4 toolcalls · 3.2s`.

### `BlockTool` — the bordered panel

Used only when there's substantial output: a diff (`Edit`, `ApplyPatch`, `Write`+diagnostics), a
todo list, long bash output. Rendered as `border={["left"]}` + `backgroundColor: backgroundPanel`
+ a `# Title` line. Long output is **truncated to N lines** (`collapseToolOutput(output, maxLines, maxChars)`;
bash uses 10, generic uses 3) with a "Click to expand" affordance.

### Spacing rule worth copying

`setPreLayoutSiblingMargin` — a row gets `marginTop: 1` **only if the previous sibling was taller
than one line** (or is flagged `alwaysSeparate`). So consecutive one-line tool rows pack tight, but
a block/diff/text paragraph always gets breathing room. This is most of what makes it read as "zen".

### Explore groups

There is no dedicated "explore group" component. Grouping is achieved three ways, all of which we
can do in Ink:
1. Consecutive inline rows visually group via the margin rule above.
2. `Read` emits `↳ Loaded <path>` children for files pulled in transitively.
3. `Task` (subagent) collapses an entire child session into **one row** whose subtitle live-updates
   to the child's current tool (`↳ Grep "foo"`), then on completion to `↳ 7 toolcalls · 12s`. It is
   clickable to descend into the child session. `Execute` does the same for batched tool calls but
   streams them from `metadata.toolCalls` instead of a child session.

---

## 4. Permission prompts

`routes/session/permission.tsx` (719 lines). Structure:

- Permission is **not a modal dialog**. It replaces the prompt input in the same bottom slot:
  `permissions().length > 0 ? <PermissionPrompt/> : questions().length > 0 ? <QuestionPrompt/> : <Prompt/>`.
  The prompt is also `disabled` while either is up. One thing has focus, always.
- Permissions are collected across the session tree (`children().flatMap(…)`) and **only the first
  is shown** — a queue, one at a time.
- Body is chosen by `permission` kind: `edit` → a full `<diff>` (split view if width > 120, else
  unified), `read` → path line, `bash` → the command, etc. Each has an icon + a title like
  `Edit src/foo.ts`.
- Three-stage store: `"permission" | "always" | "reject"`. "Always allow" pushes a confirmation
  sub-screen that **lists the exact glob patterns** it will whitelist and says "until OpenCode is
  restarted" — scope is stated explicitly. Reject pushes a free-text "why" screen whose message is
  sent back to the model.
- Footer of the prompt is the same shortcut strip as everywhere: `enter submit · esc dismiss`.
- The count also surfaces in the global footer: `△ 2 Permissions` in `theme.warning`.

## 5. Asking questions (the `question` tool)

`routes/session/question.tsx` — a structured multi-question form, not free text:

- Multiple questions become **tabs** across the top, plus a trailing `Confirm` tab. Tab headers
  color-code answered (`text`) vs unanswered (`textMuted`), active tab gets `theme.accent` bg.
- Options are a numbered list (`1. …`), arrow-key navigable, with a `description` sub-line in muted
  text. Multi-select renders `[✓] label`; single-select renders a trailing `✓`.
- Always a final `Type your own answer` option that swaps in an inline `<textarea>`.
- `Confirm` tab shows a Review list: `Header: answer` with `(not answered)` in `theme.error`.
- Contextual footer: `⇆ tab · ↑↓ select · enter toggle/submit/confirm · esc dismiss` — the enter
  verb changes with state.

---

## 6. Footer, status line, and context stats

There are **three** distinct bottom strips; the "zen without sidebar" screenshot is what you get
when the sidebar auto-hides.

**(a) Prompt meta line** (directly under the textarea, `component/prompt/index.tsx`):
`Build · claude-sonnet-4 anthropic` — agent name, optional `auto` permission-mode badge, model,
provider, optional variant badge (bold `theme.warning`).

**(b) Status line** (below the input box):
- *Idle:* left = cwd; right = `context · cost` **or**, if no usage yet, `⌃a agents  ⌃p commands`.
- *Working:* left = animated `<spinner>` (40ms frames) + optional retry text
  (`rate limited [retrying in 12s attempt #2]` in `theme.error`, click to expand);
  right = `esc interrupt`, which becomes `esc again to interrupt` after the first press
  (a counter with a reset timer, requiring two presses).

**(c) Global footer** (`routes/session/footer.tsx`): `cwd` on the left; on the right
`△ 2 Permissions · • 3 LSP · ⊙ 2 MCP · /status`. Status dots are colored (`success`/`error`/`muted`)
and the label stays plain text.

**Context stats math** (identical in `feature-plugins/sidebar/context.tsx` and the prompt's `usage()`):

```ts
const last = messages.findLast(m => m.role === "assistant" && m.tokens.output > 0)
const tokens = last.tokens.input + last.tokens.output + last.tokens.reasoning
             + last.tokens.cache.read + last.tokens.cache.write
const percent = model.limit.context ? Math.round(tokens / model.limit.context * 100) : null
const cost = session.cost   // running total, Intl.NumberFormat USD
```

Two important details: it reads the **last assistant message's cumulative tokens**, not a sum over
the conversation (cache reads would double-count); and cost is a server-maintained session total.
Rendered inline as `128,431 (64%) · $0.42`, and in the sidebar as four stacked lines.

**Sidebar visibility rule** (this is exactly the difference between the two screenshots):

```ts
wide = terminalWidth > 120
sidebarVisible = !isSubagentSession && (sidebarOpen || (sidebarPref === "auto" && wide))
contentWidth  = terminalWidth - (sidebarVisible ? 42 : 0) - 4
```

Sidebar is a fixed **42 columns**. When narrow but manually opened, it renders as an absolute
overlay over a 70/255-alpha scrim instead of stealing columns. Sidebar content itself is a plugin
slot stack: title/workspace/share → context stats → files → todo → LSP → MCP → footer.

---

## 7. Theming

- Theme is a **flat record of ~55 named RGBA roles** (`theme/index.ts`): semantic
  (`primary/secondary/accent/error/warning/success/info`), surfaces
  (`background`, `backgroundPanel`, `backgroundElement`, `backgroundMenu`), text (`text`,
  `textMuted`), borders (3), diff (14 — added/removed/context × fg/bg/line-number), markdown (13),
  syntax (9), plus a numeric `thinkingOpacity`.
- Themes are **JSON assets** (33 of them) with a `defs` block of raw hex and `{dark, light}` variants
  per role, resolved at load. No CSS, no cascade — components read `theme.textMuted` directly.
- `selectedForeground(theme, bg)` computes readable text on an accent background via luminance
  (`0.299r + 0.587g + 0.114b > 0.5`) when the theme doesn't declare one. Nice trick, ~10 lines.

---

## 8. What CLAI should build in Ink

### Event types (CLAI's own; mirror the *shape*, not their names)

```ts
type ActivityEvent =
  | { type: "turn.user";      id, text, files?: FileRef[], ts }
  | { type: "turn.assistant"; id, ts }                       // opens a turn
  | { type: "part.text";      msgId, partId, text, streaming }
  | { type: "part.reasoning"; msgId, partId, text, done, ms }
  | { type: "part.tool";      msgId, partId, callId, tool,
                              state: { status: "pending"|"running"|"completed"|"error",
                                       input?, metadata?, output?, error?, title?, ms? } }
  | { type: "turn.finish";    id, model, agent, ms, finish, error? }
  | { type: "approval.request" | "approval.resolve"; id, kind, target, diff?, patterns? }
  | { type: "question.request" | "question.resolve"; id, questions: Question[] }
  | { type: "plan.update";    todos: Todo[] }
  | { type: "verify.result";  taskId, pass, summary, logRef }   // CLAI-specific
  | { type: "memory.inject";  injected, dropped }               // CLAI-specific
  | { type: "run.status";     status: "idle"|"working"|"retry", detail? }
  | { type: "usage";          tokens, contextLimit, costUsd }
```

Reducer target — same normalized shape as their `sync` store, so the renderer stays a pure function:

```ts
{ messages: Message[], parts: Record<msgId, Part[]>, status, usage,
  approvals: Approval[], questions: Question[], todos: Todo[] }
```

This doubles as CLAI's `events.jsonl` trace record — one stream feeds both the live TUI and the
static `trace.html`, which satisfies the "no dual-write recording path" rule in `07-tui-look.md`.

### Component list (refines §4 of `07-tui-look.md`)

| Component | Notes |
|---|---|
| `<App>` | Subscribes to the event stream, owns the reducer, computes `wide = columns > 120`. |
| `<Activity>` | Maps messages → parts → components. **Window to the last N parts** (Ink has no scrollbox); older history goes to terminal scrollback via `<Static>`. |
| `<PartRouter>` | `{ text, reasoning, tool, approval, verify }` → component. Copy the `PART_MAPPING` idea. |
| `<UserTurn>` | Left border bar + panel bg + attached-file chips + optional `QUEUED` badge. |
| `<AssistantText>` | Streaming markdown, `paddingLeft={3}`. |
| `<ReasoningRow>` | Collapsed one-liner `Thought: <summary> · 4.1s`; expands on key. Spinner while live. |
| `<ToolRow>` | The `InlineTool` equivalent: 2-col icon gutter, pending verb, status color, strikethrough when denied, `↳` sub-lines. **This is the single highest-value component to get right.** |
| `<ToolBlock>` | Bordered panel for diffs / long output; truncate + "press `o` to expand". |
| `<ToolGroup>` | Subagent / batched-explore collapse-to-one-row with live subtitle. |
| `<PlanBlock>` | Todo list panel. |
| `<ApprovalPrompt>` | Replaces `<Input>` in the bottom slot. Queue of 1. Stages: ask → always(show patterns + scope) → reject(reason). |
| `<QuestionPrompt>` | Numbered options, `↑↓`/enter, "type your own", confirm/review tab. |
| `<VerifyResult>` | CLAI-specific: pass/fail row + pointer to the log. |
| `<ContextStrip>` | 42-col fixed sidebar, only when `wide`. Tokens / % / cost using their math. |
| `<StatusLine>` | Idle → cwd + `tokens (pct) · $cost`; working → spinner + `esc interrupt` / `esc again to interrupt`. |
| `<Footer>` | agent · model on the left; shortcut hints + `runId` on the right. |
| `<Input>` | Prompt, history, palette. Disabled while an approval/question is up. |

### Specific behaviours to port (cheap, high payoff)

1. **Conditional sibling margin** — pack consecutive one-line rows, space out multi-line blocks.
2. **Pending verbs** — `~ Reading file…` before input arrives; never render an empty row.
3. **Two-press interrupt** with a reset timer and a label that changes on the first press.
4. **Strikethrough for denied**, don't delete the row — the trace stays honest.
5. **Single bottom slot** shared by input / approval / question — never two focus targets.
6. **Output truncation with an explicit expand affordance**, not silent clipping.
7. **Last-assistant-message token math** for context %, not a naive sum.
8. **Width-120 breakpoint** for sidebar and diff split/unified.
9. **Semantic color roles only** — even for MVP, put ~10 named roles in one module (`text`,
   `textMuted`, `success`, `warning`, `error`, `accent`, `panelBg`) rather than literals at call
   sites. Not a theme system; just a lookup table. Don't build their 55-role JSON loader.

### Ink-specific adaptations (where the pattern does *not* transfer)

- **No mouse.** Every hover/click affordance becomes a keybinding: `o` expand focused row, `↑↓`
  move row focus, `enter` descend into a subagent group.
- **No scroll container.** Use `<Static>` for finalized history + a live tail region. Budget the
  live region; a 2700-line single-file render tree like theirs will thrash Ink's diff.
- **No `<diff>` / `<code>` / `<markdown>` intrinsics.** We need our own minimal unified-diff
  renderer (+/- gutter, colored bg) and can skip syntax highlighting for MVP.
- **No plugin slot system.** Their sidebar/footer are plugin slots (`sidebar_content`,
  `session_prompt`). Hardcode ours.

---

## 9. What NOT to copy

Reiterating and extending `07-tui-look.md` §3, now with specifics:

- **No source lifting.** Don't vendor `packages/tui`, don't port files line-by-line. The clone at
  `.scratch/opencode-ref` is read-only research and is gitignored; delete it before submission.
- **Brand assets:** `src/logo.ts`, `component/logo.tsx`, the `opencode.json` / `orng` / `lucent-orng`
  themes, the `• OpenCode <version>` sidebar footer, the wordmark split-color treatment. None of it.
- **Their naming:** `/status`, `/connect`, `/compact`, "Zen", agent names (`Build`, `Plan`), the
  `⌃x ⌃y` leader-key scheme. Pick CLAI's own verbs.
- **Their 33-theme JSON system**, `thinkingOpacity`, the syntax-style memoization. Over-scoped for us.
- **Feature surface we don't need:** sessions list/rename/share/fork/timeline/revert-redo, workspace
  and worktree management, MCP/LSP status plumbing, plugin runtime + slots, the Go/paid-tier upsell
  dialogs, `dialog-*` (25 files of them), command palette breadth. CLAI ships what its tickets need.
- **Their architecture split.** OpenCode's TUI is a thin client over a local HTTP/SSE server with an
  SDK. That's a big commitment (`packages/server`, `sdk`, `protocol`). CLAI is in-process; keep the
  *event-stream + reducer* discipline, skip the network boundary.
- **Anti-pattern to avoid:** their entire activity stream is one 2725-line file. Split ours by part
  type from day one.

---

## 10. Pi cross-check (convergent evidence)

Pi (`@earendil-works/pi-tui`) independently arrives at the same shape with a hand-rolled
differential renderer and no framework:

- Primitives only: `v-stack`/`h-stack`/`box`/`text`/`truncated-text`/`markdown`/`scroll-view`/
  `select-list`/`loader`/`editor`/`spacer`. No theme abstraction — `terminal-colors.ts`.
- `truncated-text` as a first-class primitive confirms the "one-line row, elide the middle" idiom.
- `select-list` is the shared substrate for both approvals and questions — one list widget, two uses.
  Worth copying: CLAI's `<ApprovalPrompt>` and `<QuestionPrompt>` should share one `<OptionList>`.
- Differential rendering + `alt-screen` vs `main-screen` variants (`tui-alt-screen.ts`,
  `tui-main-screen.ts`) — they support both inline-scrollback and full-screen modes. Ink is
  inline-only by default, which is the mode we want anyway.

Where two independent implementations agree — activity log of typed parts, one-line tool rows,
bottom slot shared by input/approval/question, hint footer, status/color-only-for-state — treat it
as a settled terminal-UI convention rather than someone's design, and implement it freshly.

---

## Appendix — file map for re-reading

All under `.scratch/opencode-ref/packages/tui/src/`:

| Concern | File |
|---|---|
| Activity stream + every tool renderer | `routes/session/index.tsx` (2725 L) |
| Permission prompt | `routes/session/permission.tsx` (719 L) |
| Question prompt | `routes/session/question.tsx` (515 L) |
| Global footer | `routes/session/footer.tsx` |
| Sidebar shell | `routes/session/sidebar.tsx` |
| Context tokens/%/cost | `feature-plugins/sidebar/context.tsx` |
| Prompt + status line + usage | `component/prompt/index.tsx` (1716 L) |
| Normalized store | `context/sync.tsx` (673 L) |
| Event subscription | `context/event.ts` (36 L) |
| Theme roles + JSON loader | `theme/index.ts` (1089 L), `theme/assets/*.json` |
| Output truncation | `util/collapse-tool-output.ts` |
| Conditional margin | `util/layout.ts` (`setPreLayoutSiblingMargin`) |
| Tool-name → renderer map | `routes/session/index.tsx` (`toolDisplays`, `toolDisplay`) |
