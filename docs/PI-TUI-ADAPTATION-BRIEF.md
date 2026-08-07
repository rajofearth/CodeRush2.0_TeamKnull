# Pi → CLAI TUI Adaptation Brief

Source explored (2026-08-07): [`earendil-works/pi`](https://github.com/earendil-works/pi) `@earendil-works/pi-tui` + `@earendil-works/pi-coding-agent` interactive mode (`packages/tui`, `packages/coding-agent/src/modes/interactive`). Target: CLAI Ink shell at `src/ui/`.

**Verdict:** Pi’s smoothness comes from a custom line-oriented renderer (not React/Ink): differential line updates + CSI 2026 synchronized output, application-owned **line-based** scroll with follow-end, a docked editor/footer outside the scroll region, and mutable component instances that update in place during streaming. CLAI already has follow-mode and wheel; the gap is granularity (block vs line), render atomicity, composer depth, and viewport chrome separation.

---

## 1. Package architecture (tui vs coding-agent UI)

### `@earendil-works/pi-tui` — reusable terminal framework

Owns rendering, input, layout, and primitives. No agent domain.

| Layer | Files | Role |
|-------|-------|------|
| Terminal I/O | `terminal.ts`, `stdin-buffer.ts`, `keys.ts`, native darwin/win32 | Raw mode, bracketed paste, Kitty keyboard, mouse, progress |
| Renderers | `tui.ts`, `tui-main-screen.ts`, `tui-alt-screen.ts` | Shared `TUI` interface; main buffer (scrollback) vs alt buffer (app scroll) |
| Layout | `layout.ts`, `layout-node.ts`, `v-stack.ts`, `h-stack.ts`, `scroll-view.ts` | Constrained stacks + scroll regions (alt screen only) |
| Primitives | `text`, `markdown`, `editor`, `input`, `loader`, `select-list`, `box`, `image`, … | `Component.render(width): string[]` |
| Keybindings | `keybindings.ts` | Declarative ids + `KeybindingsManager` |

Contract every widget implements:

```ts
interface Component {
  render(width: number): string[];  // one string per visual line; must ≤ width
  handleInput?(data: string): void;
  invalidate?(): void;
}
```

**Main screen (`TuiMainScreen`):** terminal owns scrollback. Differential paint of changed lines. Used as coding-agent default (`tuiMode: "regular"`).

**Alt screen (`TuiAltScreen`):** fixed terminal-height viewport; app owns scroll. `setLayoutRoot(VStack[ScrollView(transcript), dock])`. Used as `tuiMode: "fullscreen"`.

Both wrap paints in synchronized output: `\x1b[?2026h` … `\x1b[?2026l`.

### `@earendil-works/pi-coding-agent` — product UI on top of tui

`modes/interactive/interactive-mode.ts` (~6.4k LOC) is the orchestrator. It:

1. Builds a **mutable component tree** (`documentContainer` → header + resources + `chatContainer`).
2. Subscribes to `AgentSession` events and mutates components in place.
3. Mounts the same tree on either renderer; switches regular ↔ fullscreen by remounting.
4. Docks status / editor / footer **outside** the scroll view in fullscreen.

```
Fullscreen layout (VStack):
┌─────────────────────────────────────┐
│ ScrollView(documentContainer)       │  grow:1, follow:"end", primary
│   headerContainer                   │
│   loadedResourcesContainer          │
│   chatContainer  ← messages/tools   │
├─────────────────────────────────────┤
│ dock (auto height, not scrolled)    │
│   pendingMessagesContainer          │
│   statusContainer  (spinner)        │
│   widgetContainerAbove              │
│   editorContainer  (CustomEditor)   │
│   widgetContainerBelow              │
│   footerContainer  (pwd + tokens)   │
└─────────────────────────────────────┘
```

Domain components live under `modes/interactive/components/`: `assistant-message`, `user-message`, `tool-execution`, `footer`, `status-indicator`, selectors, theme JSON.

### CLAI mapping today

| Pi | CLAI |
|----|------|
| `pi-tui` Component + renderers | Ink `Box`/`Text` + `app.tsx` |
| `UiBus` equivalent | `events.ts` + `state.ts` reducer |
| `interactive-mode` | `app.tsx` + `bridge.ts` |
| Presentational widgets | `components.tsx` |
| Theme | `theme.ts` (keep metallic language) |

Do **not** fork pi-tui into CLAI. Port algorithms and interaction patterns into Ink-shaped modules under `src/ui/`.

---

## 2. Scroll model

### Line-based, not block-based

Pi scrolls by **visual terminal rows** (`scrollTop` in lines). Content is always `string[]`; layout measures height as `lines.length`.

CLAI scrolls by **activity blocks** (`scrollFromBottom` counts whole `RenderBlock`s) via `windowBlocks()` in `app.tsx`. That is coarser: a tall assistant message jumps as one unit; streaming uses an ad-hoc tail of ~18 lines inside the block.

### Follow mode

Pi `ScrollView` (`packages/tui/src/components/scroll-view.ts`):

```ts
// follow: "end" | "none"
followingEnd = (options.follow ?? "none") === "end";

scrollBy(lines):
  max = contentHeight - viewportHeight
  start = followingEnd ? max : scrollTop
  next  = clamp(start + lines, 0, max)
  followingEnd = followEnd && next === max
  return unusedDelta  // for overscroll chaining

updateLayout(contentHeight, viewportHeight):
  if followingEnd: scrollTop = max
  else: clamp scrollTop
```

**Semantics:** while at bottom, growth pins to end (streaming follows). Manual scroll away clears follow; scrolling back to `max` re-arms it. Same idea as CLAI’s `scrollFromBottom === 0`, but line-precise.

### Page size

```ts
const PAGE_SCROLL_OVERLAP = 4;
pageDelta = max(1, viewportHeight - PAGE_SCROLL_OVERLAP);
halfPage  = max(1, floor(viewportHeight / 2));
```

Defaults: `pageUp`/`pageDown` → full page; half-page bindings exist but unbound by default. `home`/`end` → top / bottom+follow.

### Wheel

SGR (`\x1b[<btn;x;yM`) and legacy (`\x1b[M...`) wheel parsing. Route:

```
remaining = direction * wheelScrollLines   // default 1 line/event
for scrollView under (x,y), deepest first:
  remaining = scrollView.scrollBy(remaining)
  if remaining==0 or overscroll=="contain": break
if remaining && primary not seen: primary.scrollBy(remaining)
```

`overscroll: "chain"` (coding-agent default) lets unused delta bubble to outer/primary. Wheel over the dock falls through to the primary transcript.

CLAI currently steps ±3 **blocks** per wheel — too chunky for smoothness.

### Sticky headers / dock

Not sticky *inside* the transcript. Fullscreen **docks** editor+status+footer as a non-scrolling stack sibling. Header/onboarding sits *inside* the scroll document (scrolls away). Changelog notes “sticky regions” for layout clip vs Kitty images — meaning fixed dock regions, not CSS sticky mid-transcript.

### Virtualization

**None (true windowing).** Every frame:

1. Recursively `render(width)` all components (with per-component width caches).
2. Layout positions children; for `ScrollView`, places child at `y - scrollTop`.
3. Paints only the clipped viewport rows onto a `height`-length screen buffer.
4. Diffs previous screen lines; writes changed rows (alt) or changed line ranges (main).

Long sessions re-render full document to strings each frame; only paint is clipped. Acceptable because render is string assembly + ANSI, not DOM. For CLAI/Ink, prefer **line-window virtualization** (only mount visible ActivityItems / line slices) because React reconciliation cost is higher.

### Pseudocode — portable scroll core for CLAI

```
type ScrollState = {
  contentLines: number   // measured after wrap
  viewport: number       // activity pane rows
  scrollTop: number
  followEnd: boolean     // true when pinned
}

function onContentGrow(s):
  if s.followEnd:
    s.scrollTop = max(0, s.contentLines - s.viewport)

function scrollBy(s, delta):
  maxTop = max(0, s.contentLines - s.viewport)
  start  = s.followEnd ? maxTop : s.scrollTop
  next   = clamp(start + delta, 0, maxTop)
  unused = (start + delta) - next   // for chaining
  s.scrollTop = next
  s.followEnd = next === maxTop
  return unused

function pageBy(s, dir):  # dir = ±1
  scrollBy(s, dir * max(1, s.viewport - 4))

function visibleSlice(allLines, s):
  return allLines.slice(s.scrollTop, s.scrollTop + s.viewport)
```

**Adaptation target:** replace `windowBlocks` + `scrollFromBottom` with line-based `scrollTop`/`followEnd`. Keep block grouping for *rendering* messages, but measure and scroll in wrapped line units.

---

## 3. Transcript / chat component

### Message order

Chronological append into `chatContainer` (oldest → newest). Spacers and borders between logical sections. User messages get a tinted `Box`; assistant markdown is unboxed.

OSC 133 semantic zones wrap user/assistant message first/last lines for prompt-jump navigation:

```ts
lines[0] = "\x1b]133;A\x07" + lines[0];
lines[last] = "\x1b]133;B\x07\x1b]133;C\x07" + lines[last];
```

Alt-screen `ctrl+shift+up/down` jumps `scrollTop` to previous/next `\x1b]133;A` line.

### Tool rendering

Tools are **siblings** of the assistant text component, not nested inside it:

1. `message_update` sees `toolCall` content → create/update `ToolExecutionComponent`, `chatContainer.addChild`.
2. `tool_execution_start/update/end` mutate the same instance (pending → success/error bg).
3. Global `ctrl+o` toggles `expanded` on all tools.
4. Custom `renderCall` / `renderResult` from tool definitions; else JSON + text fallback.
5. Pending uses `toolPendingBg`; done uses success/error bg.

Streaming assistant keeps one `AssistantMessageComponent` instance; `updateContent(message, isStreaming=true)` rebuilds children from the latest message snapshot (thinking collapsed to label when hidden).

### Streaming pipeline

```
agent_start     → WorkingStatusIndicator in statusContainer (dock)
message_start   → new AssistantMessageComponent; add to chat
message_update  → updateContent(..., true); spawn/update tool comps
message_end     → updateContent(..., false); clear streaming refs
tool_*          → mutate ToolExecutionComponent
agent_end       → clear working indicator; drop orphan streaming comp
```

Status spinner lives in the **dock**, not the transcript — so follow-scroll does not fight the loader, and the editor stays put.

CLAI today: assistant streams as activity events; tails ~18 lines while `done:false`; lifecycle line separate. Closer to correct separation, but still block-scrolled and Ink-reconciled as React trees.

### Markdown

Pi uses `marked` + custom theme callbacks + optional `highlight.js` (coding-agent). Streaming transform can soften incomplete fences. CLAI should keep simpler prose wrap unless markdown is already planned; don’t pull `marked` lightly if headless parseability matters.

---

## 4. Input composer / prompt ergonomics

Pi’s `Editor` (`components/editor.ts`, ~2.3k LOC) is the smoothness crown jewel:

| Feature | Behavior |
|---------|----------|
| Multiline | `shift+enter` / `ctrl+j` newline; `enter` submit |
| History | up at top / down at bottom browses; draft restored on exit |
| Sticky column | preferred visual column across short lines |
| Large paste | `>10 lines` or `>1000 chars` → `[paste #N +M lines]` marker; expands on submit |
| Bracketed paste | terminal `\x1b[200~…\x1b[201~`; CSI-u ctrl letters decoded inside paste |
| Autocomplete | `/` slash commands + `Tab` paths via `CombinedAutocompleteProvider` |
| Vertical editor scroll | when editor taller than remaining height, scrolls to keep cursor |
| Fake cursor + `CURSOR_MARKER` | IME positioning via hidden hardware cursor |
| Yank / undo | kill-ring `ctrl+y` / `alt+y`; undo `ctrl+-` |
| Borders | themeable top/bottom rules; border color reflects thinking level |

`CustomEditor` subclasses Editor: app keybindings intercept before editor (interrupt, model cycle, follow-up `alt+enter`, dequeue `alt+up`, external editor `ctrl+g`, …).

**Queue model:** while agent busy, Enter steers (interrupt+inject) or Alt+Enter queues follow-up; pending queue shown above editor.

CLAI `PromptBox`: single-line string state, fake caret, no multiline/history/paste markers/autocomplete. Biggest UX gap after scroll.

**Port priority for CLAI:**

1. Multiline + newline chord + submit.
2. Prompt history (up/down at edges).
3. Bracketed paste + large-paste markers.
4. Slash/file autocomplete (reuse CLAI intake/tools later).
5. Sticky column only if multiline wraps.

Prefer a dedicated `Composer` module (class or hooks) over stuffing logic into `PromptBox`. Ink’s `useInput` is weaker than pi’s raw `handleInput(data)` — may need raw stdin path alongside Ink (CLAI already does this for mouse).

---

## 5. Header / footer / status chrome

### Header

Expandable onboarding: logo + compact vs expanded keybinding hints (`ExpandableText`, `ctrl+o` related expansion). Quiet startup collapses to nearly empty. Lives *inside* scroll document.

CLAI: `Wordmark` + `StatsPanel` + brand intro — keep; don’t copy pi’s dense help wall.

### Status (dock)

`WorkingStatusIndicator` / retry / compaction / branch-summary — `Loader` subclass with themed spinner, abort hint in message. `IdleStatus` reserves 2 blank lines when `clearOnShrink` needs stable geometry.

### Footer

Two+ lines (`footer.ts`):

1. `cwd` (`~/…`) + git branch + session name  
2. `↑in ↓out Rcache Wcache CH% $cost context%/window (auto) · model · thinking`  
3. Optional extension status line  

Right-aligns model with padding; truncates with ANSI-aware `truncateToWidth` / `visibleWidth`.

CLAI `ContextStrip` + `StatsPanel` already cover model/provider/tokens/cost/credit — align formatting (compact k/M tokens, context %) but keep CLAI brand/credit rules from `src/ui/README.md`.

### Overlays

Pi modal selectors via `tui.showOverlay(component, { anchor, maxHeight, … })`. CLAI can keep side panes for plan/approvals; use Ink overlays or full-screen modal components for model picker later — don’t need pi’s overlay geometry engine first.

---

## 6. Keybindings and interaction patterns

### Registry pattern (copy the *idea*)

Namespaced ids (`tui.editor.*`, `tui.altScreen.*`, `app.*`), defaults in a table, user overrides in JSON, `matches(data, id)`. Coding-agent extends via declaration merging.

### High-value defaults for CLAI fullscreen-like shell

| Action | Pi default | CLAI suggestion |
|--------|------------|-----------------|
| Interrupt | `escape` | Keep double-esc confirm |
| Clear / exit | `ctrl+c` / `ctrl+d` empty | Align |
| Transcript page | `pageUp`/`pageDown` (fullscreen) | Line page with overlap 4 |
| Follow bottom | `end` | Already: scroll to 0 |
| Jump messages | `ctrl+shift+up/down` | Optional once messages marked |
| Expand tools | `ctrl+o` | Toggle tool detail |
| Newline / submit | `shift+enter` / `enter` | Match |
| Follow-up queue | `alt+enter` | When soft-loop supports queue |
| History | unbound dedicated; up/down at edge | Same |

Fullscreen routing: unmodified `pageUp`/`home`/`end` scroll transcript; `ctrl+` variants keep editor. CLAI should document the same split once composer is multiline.

### Mouse

Alt screen: SGR mouse, wheel targeting, drag-select + OSC 52 copy, scrollbar thumb drag, OSC 8 click-open, edge auto-scroll while selecting. CLAI already has SGR wheel + hit registry — extend hit targets; selection/copy is stretch.

---

## 7. Concrete files / APIs worth reverse-engineering into `src/ui/`

### Must study / port algorithms

| Pi file | Port into CLAI as | Why |
|---------|-------------------|-----|
| `packages/tui/src/components/scroll-view.ts` | `src/ui/scroll.ts` | follow-end, scrollBy unused delta, clamp |
| `packages/tui/src/tui-alt-screen.ts` (`routeWheel`, page keys, `PAGE_SCROLL_OVERLAP`) | `app.tsx` + `mouse.ts` | wheel chaining, page math |
| `packages/tui/src/layout.ts` (`renderLayoutFrame` clip paint) | mental model + optional line buffer | dock vs scroll regions |
| `packages/tui/src/tui-main-screen.ts` differential + `?2026` | optional `src/ui/sync-frame.ts` | flicker reduction if leaving pure Ink paint |
| `packages/tui/src/components/editor.ts` (paste, history, sticky col) | `src/ui/composer.ts` | prompt ergonomics |
| `packages/tui/src/utils.ts` (`visibleWidth`, `truncateToWidth`, `wrapTextWithAnsi`) | `src/ui/ansi-width.ts` | correct truncation with ANSI |
| `packages/tui/src/keybindings.ts` | `src/ui/keybindings.ts` | declarative bindings |
| `coding-agent/.../assistant-message.ts` | refine `AssistantProse` | streaming update pattern, thinking collapse |
| `coding-agent/.../tool-execution.ts` | refine tool blocks | in-place pending→done, expand toggle |
| `coding-agent/.../footer.ts` | `ContextStrip` / stats | density + truncation |
| `coding-agent/.../status-indicator.ts` | `LifecycleLine` / spinner | docked working state |
| `coding-agent/.../custom-editor.ts` | composer key routing | app vs editor precedence |
| `coding-agent/.../interactive-mode.ts` `handleEvent` switch | `bridge.ts` / reducer | event→UI mutation map |
| `coding-agent/docs/keybindings.md` | CLAI help / README | UX contract |

### Ink-shaped adaptation sketch

```
src/ui/
  scroll.ts          # ScrollState, scrollBy, pageBy, follow
  composer.ts        # multiline state machine (history, paste)
  keybindings.ts     # id → keys → handler
  ansi-width.ts      # visibleWidth / truncate
  app.tsx            # dock layout: Activity(scroll) | Status | Composer | Strip
  components.tsx     # keep theme; Activity paints visible line window
```

Layout goal matching pi fullscreen:

```
<Box flexDirection="column" height={rows}>
  <Box flexGrow={1} flexDirection="column">  {/* scroll viewport */}
    <ScrollCue above />
    <Activity visibleLines={...} />
    <ScrollCue below />
  </Box>
  <LifecycleLine />   {/* dock */}
  <PromptBox / Composer />
  <HintLine />
  <ContextStrip />
</Box>
```

### Differential rendering note for Ink

Ink already reconciles. Biggest wins without abandoning Ink:

1. Line-based scroll window (render fewer children).  
2. Stable keys + mutate streaming assistant text in one node (avoid remount flash).  
3. Optional synchronized output around Ink’s frame write (wrap stdout write) — experiment carefully.  
4. Don’t clear/rebuild the whole activity list on each token.

Abandoning Ink for pi-tui wholesale is a product decision; this brief assumes stay-on-Ink.

---

## 8. What NOT to copy

| Avoid | Why |
|-------|-----|
| Depend on `@earendil-works/pi-tui` | Parallel framework vs Ink; Node `>=22.19`; dual input loops; license/ops coupling |
| `marked` + full markdown theme stack (initially) | Heavy; CLAI headless wants plain text; add later if needed |
| Kitty/iTerm image protocol + photon WASM | Optional complexity; CLAI tools are text-first |
| Native darwin/win32 console addons | Non-portable; pi uses for modifiers/clipboard edges |
| `@mariozechner/clipboard` / OSC 52 selection suite (v1) | Nice later; not required for smoothness |
| OSC 133 zones (v1) | Only needed for prompt-jump; Ink may strip unknown APC/OSC |
| Pi theme JSON / accent purple-ish defaults | CLAI has metallic silver/matte black brand rules |
| Dense startup keybind essay | Conflicts with CLAI “brand first / reduce clutter” |
| Session tree / compaction / branch UI | Domain features, not smoothness |
| Bun compile / shrinkwrap packaging | Unrelated |
| `VirtualTerminal` + `@xterm/headless` as runtime dep | Test-only in pi |
| Full overlay positioning engine | CLAI panes differ; start with simple modals |
| `get-east-asian-width` unless doing real CJK editor | Pull when composer wraps CJK |
| Replacing `UiBus` event model with pi session events | Keep CLAI producer contract; only mirror UI update *patterns* |

---

## Priority roadmap (technical, not calendar)

1. **Line-based follow scroll** + page overlap 4 + wheel in lines + docked composer/status (largest perceived smoothness).  
2. **Streaming in-place updates** (one assistant node; tools as stable-keyed siblings).  
3. **Composer**: multiline, history, bracketed paste, paste markers.  
4. **Keybinding table** + fullscreen-style page vs editor split.  
5. **ANSI-aware truncate** for footer/strip.  
6. Optional: sync-output wrapper, message jump markers, tool expand chord, follow-up queue UI.

---

## Appendix A — Pi differential paint (main screen)

```
newLines = renderAll()
if overlays: composite
strip CURSOR_MARKER → hardware cursor plan
wrap with ?2026h

if first | widthChanged | heightChanged | clearOnShrink:
  full clear + write all lines
else:
  find firstChanged..lastChanged by string equality
  if firstChanged above viewport: full redraw
  else:
    move cursor to firstChanged
    rewrite only changed lines (clearEOL as needed)
?2026l
```

## Appendix B — CLAI vs Pi scroll today

```
CLAI:  scrollFromBottom = # of blocks hidden below fit window
       wheel ±3 blocks; pageUp ≈ scrollUp(+3); streaming tail 18 lines inside block

Pi:    scrollTop = line index from document top
       followEnd pins scrollTop = content - viewport
       wheel ±1 line (configurable); page = viewport - 4
       streaming grows content; follow keeps live edge without special-case tail
```

## Appendix C — Source pointers

- TUI README: `packages/tui/README.md`  
- ScrollView: `packages/tui/src/components/scroll-view.ts`  
- Alt screen input/scroll: `packages/tui/src/tui-alt-screen.ts`  
- Layout/clip: `packages/tui/src/layout.ts`  
- Editor paste/history: `packages/tui/src/components/editor.ts`  
- Interactive orchestrator: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`  
- Keybindings doc: `packages/coding-agent/docs/keybindings.md`  
- CLAI shell: `src/ui/app.tsx`, `src/ui/components.tsx`, `src/ui/README.md`
