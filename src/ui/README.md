# CLAI TUI — visual language

Rendering-layer guide for `src/ui/`. Producers emit `UiEvent`s onto a `UiBus`;
Ink components (and the headless printer) subscribe. **Do not** put colour,
icons, or brand chrome into `headless.ts` — that path stays plain and parseable.

## Brand

| Element | Rule |
|---------|------|
| Wordmark | Render **`CLAI`** once, top of the active pane — `brand.wordmark`, bold. |
| Launch intro | Large half-block `WORDMARK_LARGE` + letter shimmer (~2.2s). Skip with any key; `CLAI_NO_INTRO=1` disables. Never headless. |
| Stats panel | Top-right, two-row compact: `session` then time · tokens · cost · tools (session-derived, render-only). |
| Credit | **`by team knull`** — `text.muted`, far right of the context strip. |
| Forbidden | Neon splash screens, emoji. |

Constants live in `theme.ts` as `WORDMARK` / `WORDMARK_LARGE` / `CREDIT`. Intro: `BrandIntro`.

## Colour — metallic silver / matte black

Single module: **`theme.ts`**. No inline hex/ANSI anywhere else.

| Token | Truecolor | 16-colour fallback |
|-------|-----------|--------------------|
| `brand.wordmark` | `#E8E8ED` | bold white |
| `text.primary` | `#C0C0C8` | white |
| `text.muted` | `#6B6E76` | gray |
| `border` | `#3A3C42` | gray |
| `state.working` | `#D4A24C` | yellow |
| `state.verify` | `#8FD3E8` | cyan |
| `state.pass` | `#5FD98A` | green |
| `state.repair` | `#E08A3C` | yellow |
| `state.fail` | `#E85555` | red |
| `state.blocked` | `#6B6E76` | gray |

Depth follows **chalk.level** (`truecolor` → `256` → `16` → `none`), with
`NO_COLOR` / `CLAI_COLOR` / `FORCE_COLOR` overrides. Under `NO_COLOR`, chrome
tokens collapse to the default foreground; **state icons still print** — shape
carries meaning.

**Saturated colour is reserved for lifecycle states.** Brand and body text stay
brushed steel.

Legacy `clai.*` tokens still resolve (mapped onto this palette) so `log.ts` and
callers outside the Ink tree keep compiling without non-ui changes.

## Lifecycle — state-machine-first

Persistent single-line widget (`LifecycleLine`), not a log entry. Exactly one
icon + one colour per state — reuse this pairing in activity, plan/todo, verify,
and run summaries:

| State | Icon | Colour token |
|-------|------|--------------|
| Working | `●` | `state.working` |
| Verify | `◐` | `state.verify` |
| PASS | `✓` | `state.pass` |
| Repair | `↻` | `state.repair` |
| FAIL | `✗` | `state.fail` |
| BLOCKED | `⊘` | `state.blocked` |

Canonical table: `LIFECYCLE` / `lifecycleIcon()` in `theme.ts`.

## Icons

Allowed set only:

```
✓  ✗  ⚠  ●  ◐  ↻  ⊘
```

No emoji. Adding an icon means updating `theme.ts` **and** this README.

Braille spinner frames (`⠋⠙…`) are motion, not icons — shown only during
Working / Verify, in the matching state colour. One spinner at a time.

## Event visual priority

| Priority | Events | Treatment |
|----------|--------|-----------|
| Strong | `verify`, `plan` / `todo`, `tool_call` / `tool_result`, `approval` | Icon + colour + slight weight / indent |
| Demoted | `status`, `metrics`, `context` | Slim bottom strip only |

### Context strip

Pi-density 1–2 line footer (credit far right). Stats stay in **StatsPanel** —
strip may show compact `↑in ↓out` once, not a second full tok/cost block:

```
model · provider · sandbox · ~/cwd · ↑in ↓out          by team knull
esc interrupt · pgup/dn scroll · tab switch agent · ctrl+p commands
```

When terminal width **&lt; 100** cols, collapse meta to:

```
model · ~/cwd · PASS|FAIL     by team knull
```

When known, strip/stats show **`ctx N%`** (model context-window fill). Sticky activity lines call out prompt clean, compaction, and task-result folding.

Trace path only when there is room (`truncatePath`).

## Layout

Vertical stack (pi / Grok Build dock): **scrollback → turn status → composer → strip**.

- Activity pane: one muted top rule in `border` colour — not every sub-element; no bottom rule.
- **Pi density**: tight tool groups (zero tool↔tool gap, muted group header); at most one blank row between prose turns or tool↔prose; no per-block `marginBottom` on user / assistant / thinking / tool groups.
- **Turn status** (`LifecycleLine`): flush above the composer (no blank spacer when idle); while busy shows spinner + detail + turn elapsed on the right.
- **Composer** (`PromptBox`): full-width `─` rules (brand when focused), multiline body (wrap, last ≤5 lines), agent name (`Build`) below bottom rule. Enter submits; **Ctrl+J** inserts newline.
- Prompt keybinds (tab / ctrl+p) live on the context strip — no separate HintLine.
- **Sticky user cue**: when scrolled up (`scrollFromBottom > 0`), a one-line `› {prompt}` header stays above Activity.
- **Follow**: when not at the live edge, show `▼ follow live` (click / wheel down resumes follow).
- **Prose width**: conversation column stays full-width; readable Activity prose caps around **100** cols on ultra-wide (`columns ≥ 140`).
- Plan / approvals: quiet secondary regions (side column ≥ 120 cols for plan — never compete with transcript).
- Chronology: activity segments stay in event order (thinking → tools → reply); do not hoist later assistant text above tools.
- Primary demo target: **120** cols.
- Drop labels Ink already implies by position.

## Motion

- Exactly one spinner, Working / Verify only.
- Tool call → result is append-only; no re-render flash of prior lines.
- No animated counters, easing, or progress-bar fills.

## Streaming & logging

- Live assistant tokens arrive as `assistant` events with `done: false` (deltas), sealed with `done: true`.
- While streaming, the activity pane shows a dim **streaming** status and tails the last ~18 lines so the caret stays visible (Grok-style follow).
- When complete, omit the status line — reply text only.
- Interactive TUI writes every `UiEvent` to `<traceDir>/session.jsonl` via `attachSessionLog` (stdout stays clean for Ink).
- Headless / `clai chat` keep using `attachHeadless` / `attachLogPrinter` on stdout — unchanged parseable lines.

## Scroll (follow mode)

Line-based (pi-style): `scrollFromBottom` is **lines** from the live edge, not
block indices. `scrollFromBottom === 0` follows the end; `maxScroll =
max(0, totalLines − viewportRows)`. PageUp/Down moves `viewport − 1` lines;
wheel moves ±3. Snap back to follow when within 2 lines of the live edge.
Tall assistant replies can be scrolled through mid-message (`clipTop`). While
scrolled, the latest user prompt sticks above the activity window; ScrollCue
shows `N lines above` / `follow live`.

## Adding a `UiEvent` type

1. Extend the bus contract in `events.ts` + reducer in `state.ts` (separate change).
2. Map the new kind onto an existing lifecycle state **or** document a new icon
   in this README and `theme.ts`.
3. Strong events → activity treatment; demoted facts → context strip only.
4. Never teach the headless printer metallic chrome.
