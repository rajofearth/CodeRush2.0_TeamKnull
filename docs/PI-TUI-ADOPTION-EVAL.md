# CLAI ↔ `@earendil-works/pi-tui` adoption evaluation

**Date:** 2026-08-07  
**CLAI:** Ink 5 + React 18, `engines.node: ">=20"`, ~4.4k LOC under `src/ui/`  
**Question:** Adopt pi-tui (or coding-agent UI packages) as a dependency, hybridize, or stay Ink and port look/UX?

**Verdict: (C) Stay on Ink. Do not add `@earendil-works/pi-tui` or `@earendil-works/pi-coding-agent` as a runtime dependency.** Port concrete visual/UX patterns into the existing `UiBus` → Ink shell. Adopting pi-tui is feasible only as a full renderer rewrite, and it is **not** easier than porting look/UX this session.

Companion: [`docs/PI-TUI-ADAPTATION-BRIEF.md`](./PI-TUI-ADAPTATION-BRIEF.md) (pattern port how-to) · [`assets/22-renderer-decision.md`](../assets/22-renderer-decision.md) (Ink + mouse already decided).

---

## 1. Package facts

### `@earendil-works/pi-tui`

| Field | Value |
|-------|--------|
| Latest | **0.84.1** (2026-08-07) |
| Dist-tag `legacy-node20` | **0.74.2** (Node `>=20`) |
| `engines.node` (latest) | **`>=22.19.0`** |
| Peer deps | **none** |
| Runtime deps | `marked@18.0.5`, `get-east-asian-width@1.6.0` |
| React / Ink | **Not used.** Custom `Component { render(width): string[] }` |
| License | MIT |
| Repo path | `packages/tui` in [earendil-works/pi](https://github.com/earendil-works/pi) |

What it is: a hand-rolled TUI framework (main-screen + alt-screen renderers, line-diff paint, CSI `?2026` sync output, `Editor`, `ScrollView`, `VStack`/`HStack`, overlays, SGR mouse). It is a **renderer**, not a React component library.

### `@earendil-works/pi-coding-agent`

| Field | Value |
|-------|--------|
| Latest aligned | **0.84.1** |
| `engines.node` | **`>=22.19.0`** |
| Pulls | `@earendil-works/pi-tui`, `pi-ai`, `pi-agent-core`, `pi-client`, `pi-protocol`, plus chalk/diff/glob/… |
| Interactive UI | **Not separately publishable.** Lives in `modes/interactive/` (~6.4k LOC orchestrator + domain components). Built **on** pi-tui classes (`UserMessageComponent`, `AssistantMessageComponent`, `ToolExecutionComponent`, `FooterComponent`, `CustomEditor`, …). |

You cannot import coding-agent transcript chrome without taking pi-tui (and most of the agent surface). There is no “just the look” npm package.

### Engine clash with CLAI

| Runtime | Requirement |
|---------|-------------|
| CLAI today | `>=20` |
| pi-tui / coding-agent latest | `>=22.19.0` |
| This evaluation host | Node **v22.14.0** (still **below** 22.19) |

Even if CLAI raised its floor to Node 22, **latest pi-tui still requires 22.19+**. The only Node-20-compatible line is the stale `legacy-node20` tag (`0.74.2`), ~10 minors behind and not what coding-agent 0.84 expects.

### Install steps (if someone still forces A)

```bash
# Not recommended — for completeness only.
# Option 1: latest (needs Node >= 22.19)
pnpm add @earendil-works/pi-tui@0.84.1
# engines will warn/fail on Node 20 and on 22.14

# Option 2: Node 20-compatible but outdated
pnpm add @earendil-works/pi-tui@legacy-node20   # 0.74.2

# coding-agent is the product agent, not a UI kit:
pnpm add @earendil-works/pi-coding-agent@0.84.1  # pulls whole stack
```

After install you still must **rewrite** `src/ui/app.tsx` + `components.tsx` into `render(): string[]` components and give up Ink’s React tree. There is no drop-in `<PiFoo />` for Ink.

---

## 2. Does it conflict with Ink?

**Yes — they cannot share one interactive session.** Hybrid (B) is the worst option.

| Concern | Reality |
|---------|---------|
| Component model | Ink = React `Box`/`Text`. pi-tui = imperative classes returning `string[]`. No adapters, no JSX bridge. |
| stdin | Both want raw mode + exclusive keyboard. CLAI already also owns SGR mouse on stdin (`src/ui/mouse.ts`). A second stack races the same fd. |
| Screen buffer | Both want alt-screen / full-frame control. Dual ownership → flicker, cursor fights, broken teardown. |
| Coexistence pattern that works | Headless / offline: CLAI can *invoke* the `pi` CLI as a peer harness (`src/bench/compare-pi.ts`) without importing pi-tui. That is process isolation, not UI composition. |

Prior team decision ([`assets/22-renderer-decision.md`](../assets/22-renderer-decision.md)) already rejected “Pi-style custom transcript + Ink for input” as two input stacks. This eval reaffirms that.

**Implication:** adopting pi-tui means **replace Ink entirely** for the interactive TUI (keep `UiBus` / reducer / headless). Partial import of `Editor` or `ScrollView` into an Ink app is not viable.

---

## 3. Migration cost (`UiBus` → pi components)

### What survives unchanged

| Module | Role | Touched by pi adopt? |
|--------|------|----------------------|
| `events.ts` / `createUiBus` | Producer contract | No — keep |
| `state.ts` / `reduceUiEvent` | Pure fold | No — keep (or thin adapter) |
| `headless.ts` / `log.ts` | Non-TTY | No — keep |
| `bridge.ts` | Tool plane → bus | No — keep |
| `theme.ts` tokens | Brand language | Keep CLAI metallic; map only if rewriting paint |

### What must be rewritten

| Surface | LOC (approx) | Work |
|---------|--------------|------|
| `app.tsx` | ~880 | Replace `render()`/`useInput` with `TuiAltScreen` + `VStack`/`ScrollView` dock layout |
| `components.tsx` | ~1360 | Every Ink widget → pi `Component` |
| `mouse.ts` | ~380 | Delete or rewrite against pi’s mouse (pi already first-class) |
| `index.tsx` / checks | ~200 | New mount path |
| React/Ink deps | — | Remove `ink`, `react`, `@types/react` |

**Cost shape:** full view-layer rewrite (≈2.5k+ LOC of Ink React → imperative string renderers), plus Node engine bump to ≥22.19, plus learning pi’s invalidate/`requestRender` discipline. `UiBus` does **not** make this cheap — it only protects producers and headless.

**Compared to (C):** porting look/UX is localized edits to `theme.ts`, `components.tsx`, `app.tsx` layout (dock vs scroll), and maybe a new `scroll.ts` / `composer.ts`. Same brand rules in `src/ui/README.md` stay authoritative.

---

## 4. Recommendation

| Option | Meaning | Score |
|--------|---------|-------|
| **(A) Adopt pi-tui as renderer** | Drop Ink; rebuild shell on pi-tui | Reject — Node engines, full rewrite, brand/theme rewrite pressure, no easier path this session |
| **(B) Hybrid** | Ink + some pi widgets / dual stacks | Reject — stdin/screen conflict; prior decision already killed this |
| **(C) Stay Ink, port pi look/UX** | Keep Ink 5 + React 18; copy density, dock, composer chrome, footer strings, tool/transcript layout | **Choose** |

Adopting pi-tui is **not** feasible-and-easier. It is feasible only as a multi-file renderer replacement after raising Node to ≥22.19, and that is harder than the Ink port checklist below.

Also: CLAI’s locked visual language is **metallic silver / matte black** with saturated colour reserved for lifecycle (`src/ui/README.md`, `theme.ts`). Pi’s default `dark.json` is a different palette (cyan accent, blue borders, tinted message/tool backgrounds). Port **structure and density**, not Pi’s hex values wholesale.

---

## 5. Concrete Pi visual / UX specs (coding-agent interactive)

Extracted from `packages/coding-agent` interactive UI + built-in `dark.json` / `light.json` (2026-08-07 main). Use as **reference measurements**, then map onto CLAI tokens.

### 5.1 Theme tokens (dark.json)

**Vars**

| Var | Hex |
|-----|-----|
| cyan | `#00d7ff` |
| blue | `#5f87ff` |
| green | `#b5bd68` |
| red | `#cc6666` |
| yellow | `#ffff00` |
| text | `#d4d4d4` |
| gray | `#808080` |
| dimGray | `#666666` |
| darkGray | `#505050` |
| accent | `#8abeb7` |
| selectedBg | `#3a3a4a` |
| userMsgBg | `#343541` |
| toolPendingBg | `#282832` |
| toolSuccessBg | `#283228` |
| toolErrorBg | `#3c2828` |
| customMsgBg | `#2d2838` |

**Semantic colors (selected)**

| Token | Resolves to | Role |
|-------|-------------|------|
| `accent` | `#8abeb7` | Logo, spinner, selected |
| `border` | `#5f87ff` | Normal rules |
| `borderAccent` | `#00d7ff` | Highlighted borders |
| `borderMuted` | `#505050` | Default editor border |
| `success` / `error` / `warning` | green / red / yellow | Status |
| `muted` / `dim` | `#808080` / `#666666` | Secondary / tertiary text |
| `text` | `#d4d4d4` | Body |
| `thinkingText` | gray | Thinking blocks (often italic) |
| `userMessageBg` / `userMessageText` | `#343541` / text | User bubble |
| `toolPendingBg` / `toolSuccessBg` / `toolErrorBg` | see vars | Tool box backgrounds |
| `toolTitle` / `toolOutput` | text / gray | Tool chrome |
| Thinking border ramp | `thinkingOff`…`thinkingMax` | Editor top/bottom rule colour by thinking level |
| `bashMode` | green | Editor border when `!` bash mode |

**CLAI mapping hint:** keep CLAI `brand.wordmark` / `text.*` / `border` / `state.*`. Optionally add quiet panel backgrounds for user/tool blocks from CLAI’s existing legacy `clai.backgroundPanel` / success/error diff bgs — do **not** import Pi cyan/blue accents into CLAI chrome.

### 5.2 Layout chrome (fullscreen / alt-screen)

```
┌──────────────────────────────────────────────┐
│ ScrollView(document)          grow:1 follow:end
│   header (logo · hints) — scrolls away
│   resources / notices
│   transcript (user / assistant / tools)
├──────────────────────────────────────────────┤
│ DOCK (not scrolled)                           │
│   pending / queued messages                   │
│   statusContainer  (Working spinner / Idle)   │
│   editor (CustomEditor)                       │
│   footer (2–3 lines)                          │
└──────────────────────────────────────────────┘
```

- Transcript scrolls; **composer + status + footer stay docked**.
- `IdleStatus` renders **two blank lines** to reserve dock height when idle (`clearOnShrink` geometry).
- Horizontal rules: `DynamicBorder` = `─`.repeat(width) in `border` (or themed) colour.
- Default content pad: `outputPad = 1` (1 col left padding on markdown/tool text).
- Editor: top + bottom full-width `─` borders; colour = thinking level or bash mode; height ≤ **30% of terminal rows**, min **5** lines; optional `paddingX`.

### 5.3 Transcript row layouts

**User**

- `Box(padX=outputPad, padY=1)` with **background** `userMessageBg` across the content width.
- Markdown body in `userMessageText`.
- OSC 133 zone markers on first/last line (prompt-jump; skip for CLAI v1).

**Assistant**

- Leading `Spacer(1)` when there is visible text/thinking.
- Text: Markdown, **no background**, `outputPad` X, `paddingY=0`.
- Thinking: italic `thinkingText`; or collapsed single label `"Thinking..."` when hide-thinking is on.
- Errors/aborts: `error`-coloured line after content (`"Operation aborted"`, `"Error: …"`, truncated notice).
- Tool calls are **sibling** components under the chat container, not nested inside the assistant markdown component.

**Tools**

- Leading `Spacer(1)`.
- Default shell: `Box(1,1)` with bg:
  - pending / partial → `toolPendingBg`
  - success → `toolSuccessBg`
  - error → `toolErrorBg`
- Title: bold `toolTitle` (tool name); output: `toolOutput`.
- Expand/collapse of result body (global chord in Pi: expand tools).
- Images optional (Kitty/iTerm); ignore for CLAI.

**Working / status (dock, not transcript)**

| Kind | Spinner colour | Message |
|------|----------------|---------|
| working | `accent` | custom muted message |
| retry | `warning` | `Retrying (n/max) in Xs... (Esc to cancel)` |
| compaction | `accent` | `Compacting context...` / `Auto-compacting...` + cancel hint |
| branchSummary | `accent` | `Summarizing branch... (Esc to cancel)` |

### 5.4 Footer / header strings and density

**Footer** (`FooterComponent.render` → 2+ lines, mostly `dim`):

1. `cwd` with `~` substitution · `(gitBranch)` · `• sessionName`
2. Stats left + model right:
   - `↑{in} ↓{out} R{cacheRead} W{cacheWrite} CH{hit%} $cost context%/window (auto)`
   - Token format: `<1000` raw; else `1.2k` / `12k` / `1.2M` / `12M`
   - Cost: `$0.000` three decimals; subscription suffix ` (sub)` when applicable
   - Context %: `error` if >90, `warning` if >70, else plain; `?/{window}` when unknown
   - Right: `modelId` or `modelId • thinkingLevel` / `• thinking off`; optional `(provider)` prefix if multiple providers and width allows
3. Optional extension status line (space-joined, truncated)

**Header (startup, inside scroll):**

- `bold(accent(APP_NAME)) + dim(" v{version}")`
- Expandable keybinding hints (quiet startup collapses) — **do not** copy dense help wall into CLAI (brand rules forbid clutter).

**Key hint paint:** `dim(key) + muted(" " + description)`.

### 5.5 Composer chrome

- Full-width top/bottom `─` in `borderMuted` by default; switches to thinking-level / bash colours.
- Multiline editor with history, bracketed paste, autocomplete list under the box.
- While streaming: Enter **steers**; Alt+Enter **queues** follow-up; pending queue shown above editor.
- Escape: interrupt (CLAI already uses double-esc confirm — keep).

### 5.6 Spacing / borders (numbers)

| Element | Spec |
|---------|------|
| Section rule | `─` × terminal width |
| Changelog / notice block | DynamicBorder above + below; Spacer(1) around content |
| User box vertical pad | 1 |
| User/assistant/tool horizontal pad | `outputPad` default **1** |
| Gap before tool block | Spacer(1) |
| Gap before assistant content | Spacer(1) when has content |
| Editor max height | `max(5, floor(rows * 0.3))` |
| Page scroll overlap | **4** lines (`page = viewport - 4`) |
| Wheel default | **1** line per event (chain overscroll) |
| Idle status reservation | **2** blank lines |
| Min padding between footer stats and model | **2** spaces |

---

## 6. Prioritized port checklist (this session, stay on Ink)

Do these in order. All stay inside `src/ui/` + README; **no new pi-* dependency**.

### P0 — highest perceived Pi-ness (dock + density)

1. **Dock layout in `app.tsx`**  
   Activity viewport `flexGrow={1}` only; pin `LifecycleLine` → `PromptBox` → `HintLine` → `ContextStrip` below (never scrolled with transcript). Matches Pi fullscreen dock.

2. **Line-oriented follow scroll (start)**  
   Introduce `scroll.ts` with `scrollTop` / `followEnd` / `scrollBy` / page overlap 4. Measure blocks in wrapped lines; wheel ±1–3 **lines** (not ±3 blocks). Keep `scrollFromBottom===0` semantics as `followEnd`.

3. **Composer chrome → dual `─` rules**  
   Change `PromptBox` from left-rule only to top+bottom full-width `─` in `border` / focused `brand.wordmark` (CLAI tokens). Keep agent/model on the second inner line.

4. **Footer density**  
   Expand `ContextStrip` toward Pi’s 2-line dim footer:  
   `cwd (branch)` · credit  
   `↑in ↓out $cost context%` … right-aligned `model`  
   Add compact token formatter (`1.2k` / `12k`) beside existing `formatTokens`. Keep `by team knull`.

5. **Status stays in dock**  
   Ensure `LifecycleLine` / working spinner never sits inside the scrolled activity list (already mostly true — enforce after dock refactor).

### P1 — transcript / tools

6. **Tool row expand chord** — `ctrl+o` toggles detail on completed tools (Pi expand). Collapsed = one-liner; expanded = wrapped detail.

7. **Tool state backgrounds (optional, quiet)** — pending/ok/fail using CLAI `clai.backgroundElement` / success/error tint panels — **metallic**, not Pi cyan boxes.

8. **User turn as soft panel** — light `clai.backgroundPanel` behind `›` user lines (Pi userMessageBg analogue without Pi colours).

9. **Assistant streaming** — keep single keyed assistant node; drop special-case 18-line tail once line-scroll exists; show italic muted thinking label only if/when thinking events exist.

10. **Retry / rate-limit string** — when adapter retries: `Retrying (n/max) in Xs… (esc to cancel)` on the dock status line (Pi `RetryStatusIndicator`).

### P2 — composer depth (larger; start stubs this session)

11. Multiline input + `shift+enter` newline / `enter` submit (new `composer.ts` state machine; may need raw stdin paste path alongside `useInput`).

12. Prompt history at empty-line up/down.

13. Busy-path **queue** UI (show pending line above composer) instead of hard-locking input — needs soft-loop support.

14. ANSI-aware `visibleWidth` / `truncateToWidth` for footer (port algorithm, not package).

### Explicit non-goals this session

- `pnpm add @earendil-works/pi-tui` / `pi-coding-agent`
- Pi theme JSON / thinking-border rainbow as CLAI accent
- OSC 133 / Kitty images / native console addons
- Replacing `UiBus` with Pi session events
- Dense Pi startup keybind essay

---

## 7. Decision record (one paragraph)

CLAI should **not** adopt `@earendil-works/pi-tui` as a dependency. Latest pi-tui is a non-React renderer requiring Node ≥22.19, conflicts with Ink on stdin and the screen buffer, and would force rewriting the entire interactive view while coding-agent UI components are not usable without that stack. Stay on Ink 5 + React 18; keep `UiBus`; port Pi’s dock layout, line-follow scroll, composer/footer density, and tool expand behaviour using CLAI’s metallic theme. That is the only option that is both aligned with [`assets/22-renderer-decision.md`](../assets/22-renderer-decision.md) and implementable incrementally this session.
