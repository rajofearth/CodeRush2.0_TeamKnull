# Grok Build → CLAI UI Adaptation Brief

Design brief for adapting [xai-org/grok-build](https://github.com/xai-org/grok-build) terminal UI patterns into CLAI’s Ink ADE shell. **Adapt patterns, do not port Rust.**

**Source studied:** `xai-grok-pager` (ratatui TUI), especially `AgentViewLayout`, scrollback blocks/`AcpUpdateTracker`, turn status, prompt widget, panes, follow/sticky scroll. Synced tree as of clone date; primary docs under `crates/codegen/xai-grok-pager/docs/`.

**CLAI today:** Ink shell in `src/ui/` — `ClaiApp` + `UiBus`/`reduceUiEvent` activity column, plan/approvals, stats panel, context strip, mouse wheel follow. Already mirrors some grok ideas (sticky follow via `scrollFromBottom === 0`, tool groups, lifecycle line).

---

## 1. What grok-build’s agent screen actually is

Vertical stack (top → bottom), from `AgentViewLayout`:

```text
┌─ status bar (1 row, right-aligned chips) ─────────────────────────┐
│  [startup warnings]                                                │
│  [tasks pane]   ← bg jobs / subagents / loops (optional)           │
│  [catalog pane] ← subagent catalog (optional)                      │
│  [todo pane]    ← live plan (optional; also Ctrl+T)                │
│                                                                    │
│  SCROLLBACK  (Min(5)+)   ± timeline rail / scrollbar               │
│    sticky user-prompt headers when scrolled                        │
│                                                                    │
│  [/btw overlay]                                                    │
│  [queue pane]                                                      │
│  turn status (1 row)  ← spinner · activity · timers · [stop]       │
│  [banner / plugin CTA / follow-up chips / voice]                   │
│  PROMPT COMPOSER                                                   │
│  shortcuts bar (context-sensitive key hints)                       │
└────────────────────────────────────────────────────────────────────┘
```

Mental model from the tutorial: **scrollback + prompt + shortcuts bar**; todos/tasks **slide in** when needed — not a permanent dashboard chrome.

Horizontal entry chrome (`HorizontalLayout`):

```text
│A│ PL │ Content… │ PR │
 1   2    flex       1
```

- **A** = accent column (animated wave while running; static color when done)
- Selection border paints into outer padding, not into content

### Modes (do not confuse)

| Mode | Role |
|------|------|
| Fullscreen TUI | Full layout above; themes, mouse, panes |
| **Minimal** (`--minimal`) | Scrollback-native; no theme chrome; terminal default fg/bg; no shortcuts bar / dashboard |
| Dashboard (`Ctrl+\`) | Multi-agent roster — **out of scope** for first CLAI ADE pass |
| ACP / headless | Same agent runtime, different surfaces |

CLAI should target the **fullscreen agent view** patterns first, optionally a later “compact” density mode — not minimal-mode ratatui specifics.

---

## 2. Component map (grok → CLAI Ink)

| Grok Build | Role | CLAI today | Build / evolve |
|------------|------|------------|----------------|
| `AgentStatusBar` | Top row: cwd/path · context `8.5K/1.0M` · bg spinner count · plan chip · goal · MCP init · queue | `Wordmark` + `StatsPanel` (top-right session numbers) | Split: keep brand left; move **live context % + cwd + running-bg count** into a true top status row or demote duplicates from footer |
| Timeline rail | Left ticks for turns; hover peek; replaces scrollbar when on | None | **Defer** — high cost in Ink; PageUp/turn-jump first |
| `ScrollbackPane` + sticky headers | Virtualized transcript; iOS-style sticky user prompts | `Activity` + `windowBlocks` (block-fit, not virtualized) | Keep block windowing; add **sticky last-user-prompt line** when `scrollFromBottom > 0` |
| Block types (`RenderBlock`) | Typed entries with fold modes | `ActivityItem` + `RenderBlock` (single \| toolGroup) | Extend item kinds: `thinking`, `file_write`/`edit`, `task`/`subagent`, `bg_task` |
| `ThinkingBlock` | Collapsed / Truncated / Expanded; dim italic body; “Thought for Xs” | No CoT surface (status line only) | Optional `thinking` events; default **truncated tail**; never invent fake thoughts |
| Tool blocks (read/search/edit/execute/…) | Kind-specific: inline diffs, streaming stdout, bullet | Flat `ToolRowLine` | Specialize **edit/write** (diff preview) and **bash** (streaming tail); keep others dense one-liners |
| `SubagentBlock` / `BgTaskBlock` | Collapsed lifecycle rows; Enter opens child view | Partial via `group` on tools; `task` agents exist in harness | Transcript row + optional **TasksPane** overlay; fullscreen child view later |
| `TodoPane` | Overlay list □/▶/✓/✗ | `PlanPane` (inline or narrow sidebar) | Keep plan as **overlay or below-scrollback pane**, not competing with transcript; Ctrl+T toggle |
| `TasksPane` | Running bg/subagents/loops | None in TUI (shell jobs exist) | New `TasksPane` driven by `bash_bg` / `task` events |
| `TurnStatus` | Between scrollback & prompt: `⠧ Run command 0.2s … 1m20s ⇣12k [stop]` | `LifecycleLine` under activity | Promote to **fixed row above composer**; add phase timer + stop hit target |
| `PromptWidget` | Multi-line, chrome/prefix, `@`/`/`/`!`/`#` modes, image chips, info row (agent/model) | `PromptBox` (2 lines: input + agent/model) | Grow toward multi-line + slash/file pickers; keep CLAI metallic chrome |
| `ShortcutsBar` | Dynamic, pinned hints; double-press confirm replaces all | `HintLine` + strip interrupt hints | Unify into one **footer shortcuts strip** that changes with focus/busy |
| `ContextBar` | Status-bar chip (tokens, hover → bar+%) | Footer `ContextStrip` + top StatsPanel | Prefer **one** context surface (status or strip), not both showing the same numbers |
| Follow indicator | `▶` follow / `▼` more below (list panes) | `ScrollCue` ↑↓ | Keep; rename cues to match follow semantics |
| Permission / question / cancel cards | Modal focus steal; park to scrollback | `ApprovalsPane` | Keep; adopt **park Esc → scrollback, Tab back** contract when interactive approvals harden |
| Block viewer (Enter) | Fullscreen detail | Expand-in-place only | Optional later; expand + detail dump is enough for v1 |
| Welcome / braille logo | Startup | `BrandIntro` | Keep CLAI intro; don’t copy Grok logo |

---

## 3. Chronological transcript rules

Grok’s law: **append in appearance order; mutate in place by id; never reorder kinds into buckets.**

`AcpUpdateTracker` encodes this:

1. **User prompt** pushed at send time (ACP echo suppressed).
2. Optional **pre-created thinking** (“Thinking…”) so the turn isn’t blank.
3. **Thought chunks** append to current thinking entry.
4. **Tool call** → `finish_thinking`, clear current agent message cursor, `push_block(tool)` (or suppress plumbing tools like todo/task/wait into panes/status only).
5. **Tool updates** mutate the same entry (stdout stream, status, diffs).
6. **Agent message chunks** → `finish_thinking`, append to current agent message (or start new streaming agent block).
7. New **stream_start_ms** → finish open thinking/agent message so the next phase is a **new** block (mid-turn restarts don’t merge into stale prose).
8. Turn end → finish thinking (drop if empty), finish agent message, finish pending tools.

### CLAI rules to adopt (UiBus / reducer)

| Rule | Detail |
|------|--------|
| **Appearance order** | `items[]` is chronological. New user / thinking / tool_call / assistant / file_write / task rows **append**. Results/status **replace by id**, never move the row. |
| **Interleave** | After tools, a new assistant stream is a **new** `assistant` id (or explicit `assistant` restart), not a silent prepend above tools. |
| **Thinking** | Optional. If enabled: own `kind: "thinking"` item; stream append; on tool/assistant start mark `done` and collapse. Empty thinking removed. |
| **File writes** | Prefer a dedicated `file_write` / edit item (path + hunk summary) at tool_call time; stream hunks into that id. Don’t hide edits only inside generic tool detail. |
| **Plumbing tools** | `todo` / plan updates refresh **PlanPane**, not a noisy tool row (match grok’s suppressed TodoWrite). Same for pure wait/poll if status already shows “waiting”. |
| **Subagents / tasks** | On spawn: append collapsed `task` row; progress updates mutate that row; completion may append a second completed row for background (grok pattern) or mutate in place for foreground — pick one and document; prefer **mutate in place** for CLAI simplicity. |
| **Grouping** | Adjacent tools with same `group` stay a dense `toolGroup` (already in CLAI). Groupable thinking/tools lose vertical gap; user/assistant always break groups (grok `is_groupable`). |
| **Headless parity** | Same reducer feeds headless printer — chronological JSONL/print must match TUI order. |

### Anti-patterns to avoid

- Separate columns for “tools” vs “chat” that break time order.
- Collapsing an entire turn into one card until complete.
- Moving completed tools to a summary footer out of sequence.
- Showing thinking *instead of* tools when both happened (show both, in order).

---

## 4. Streaming / file writes / subagents / tasks — visualization

### Streaming assistant

- Live caret / braille spinner on the open assistant block.
- Tail truncation while streaming (CLAI already tails ~18 lines); on `done`, show full (or fold to truncated with expand).
- Markdown optional later; plain wrap is fine for ADE v1.

### Streaming tools

| Kind | Grok behavior | CLAI adaptation |
|------|---------------|-----------------|
| Execute / bash | Truncated streaming preview while running; collapse on finish | Spinner + command; expand shows last N stdout lines |
| Edit / write | Inline unified diff, syntax HL, progressive hunk→file HL | Path + `+n/-m`; expand shows unified diff (no syntect required — ANSI color from theme tokens) |
| Read / grep / glob | Dense one-liner + optional preview panel | Keep dense; expand for preview |
| Subagent | Always-collapsed; animated bullet; activity label (“Thinking”, “Running: …”); Enter → child scrollback | Collapsed `task` row + activity; click/expand for summary; child TUI later |
| Bg task | Started / Completed / Failed lifecycle blocks | Map `bash_bg` → started row; `bash_jobs`/completion → mutate or append done |

### Turn status (above composer)

Copy the **information architecture**, not the glyphs:

```text
⠋  Editing src/ui/app.tsx  2.1s              0:42  12.4k tok  [esc]
```

- Left: spinner + activity (thinking / tool title / “responding” / “waiting on you”)
- Right: turn timer, optional token delta, interrupt affordance
- Hidden when idle; still show “N commands still running” when bg watchers remain (grok watcher cue)

---

## 5. Scroll / follow behavior

Grok (`ScrollbackState`):

- **`follow_mode`** default on → `scroll_offset = max` each frame.
- Manual scroll / selection away from tail → leave follow.
- **`follow_preserve_scroll`**: after send, pin user prompt at top (“page flip”) until content overflows, then resume bottom follow.
- Sticky headers: last scrolled-past user prompt pins; next prompt **pushes** it off.
- Expanding a block while following can stop follow if `respect_manual_folds` (opt-in).
- Resume: jump bottom / select last / send new prompt.
- Indicators: follow `▶` vs content below `▼`.

CLAI already:

- `scrollFromBottom === 0` = follow live edge.
- New blocks while scrolled up advance offset (anchor preservation).
- Wheel / PageUp/Dn / ScrollCue.

**Adopt next:**

1. On new **user** submit: optional page-flip (prompt near top) then follow — or snap follow immediately (simpler; document choice).
2. Sticky one-line **› last user prompt** when not at bottom.
3. Expanding a tool while following: keep follow (default); don’t jump selection away.
4. “Follow live” cue only when `scrollFromBottom > 0`.
5. Defer true virtualization until transcripts get huge; block-budget windowing is enough.

---

## 6. Visual language (icons, status, density)

### Grok cues worth copying as *semantics*

| Cue | Meaning |
|-----|---------|
| Animated accent / bullet | Block still running |
| Green / red bullet | Success / fail |
| Dim + italic (thinking body) | Secondary / CoT |
| Dense packing | Adjacent groupable tools (no blank lines) |
| Breathing room | Around user + assistant prose |
| □ ▶ ✓ ✗ | Todo states |
| ⋅/:/⸬/⁙ or braille | Working spinner (dashboard vs turn status differ) |
| ● / ○ | Needs input vs idle (dashboard) |
| Dim `│` separators | Status bar chips |
| Context urgency gradient | Tokens chip shifts color by % |

### CLAI keep

- Metallic silver / matte black (`src/ui/theme.ts`); lifecycle saturation only.
- Existing lifecycle icons (working / verify / pass / fail / blocked).
- Brand intro — don’t replace with Grok braille logo.

### Density

- Tools: 1 row collapsed; detail on expand.
- Thinking: truncated by default.
- Assistant: full when done; tail while streaming.
- Plan/tasks: panes, not permanent side chrome on narrow terminals.
- Auto-compact under ~20 rows (grok): hide CTA/chips before starving prompt/scrollback.

---

## 7. Sidepanel, composer, header, footer — copy-worthy patterns

### Side / overlay panes (not a permanent right rail)

Grok’s “sidepanel” is really **height-sliced overlays** (todo, tasks, catalog, queue) above the scrollback or between scrollback and prompt — toggleable. CLAI’s wide-terminal `PlanPane` sidebar is optional; prefer:

- **Default:** plan under scrollback or collapsed until `todo` events exist.
- **Wide:** optional right column OK if it doesn’t steal transcript width below ~100 cols.
- **Tasks:** overlay list of bg + subagent rows with kill affordance.

### Composer

Copy:

- Multi-line growth with max height clamp (~⅓ screen).
- Prefix modes later: normal / `!` bash / `/` slash (CLAI can start with `/` only).
- Info row: agent · model · provider (already present).
- Placeholder rotation (already present).
- While busy: accept queue text or disable with “working…” — grok queues; CLAI can start with disable then add queue.

Skip initially: image chips, voice overlay, vim textarea internals (`xai-ratatui-textarea`).

### Header / status

Copy: **right-aligned chip bar** (context, running count, plan). Keep CLAI wordmark left. Avoid duplicating the same token/cost triple in header *and* footer *and* stats panel — pick two surfaces max.

### Footer / shortcuts

Copy: **one** context-sensitive shortcuts row; double-press confirm replaces hints (“press again to interrupt”). CLAI’s esc-arm already matches; surface it only on the shortcuts strip.

---

## 8. Concrete Ink / React structure

Recommended tree (evolve `src/ui/`, don’t add a parallel framework):

```text
ClaiApp
├── StatusHeader          // Wordmark | chips (context, bg, plan)
├── Body (flexGrow)
│   ├── TasksPane?        // optional overlay
│   ├── ScrollRegion
│   │   ├── StickyUserCue?  // when !atBottom
│   │   ├── ScrollCue up
│   │   ├── Activity        // chronological blocks
│   │   ├── ScrollCue down / follow
│   │   └── (selection expand state)
│   ├── PlanPane? / ApprovalsPane?
│   ├── TurnStatus          // LifecycleLine promoted
│   └── Composer
│       ├── PromptBox
│       └── ComposerHints   // tab / slash
└── ShortcutsStrip          // ContextStrip + dynamic hints + credit
```

### State (keep event → reduce → render)

Extend `ActivityItem`:

```ts
| { kind: "thinking"; id: string; text: string; done: boolean; elapsedMs?: number }
| { kind: "file_write"; id: string; path: string; status; +/-; diff?: string }
| { kind: "task"; id: string; label: string; agent?: string; status; activity?: string }
| { kind: "bg_task"; id: string; command: string; status; ... }
```

Extend `UiEvent` symmetrically. Producers (adapter/tools/agents) emit only; Ink never imports harness internals.

### Layout helpers

- Pure `computeShellLayout({ columns, rows, compact, heights })` mirroring `AgentViewLayout.compute` — unit-testable without Ink.
- Keep `windowBlocks` / `blockHeight`; add sticky cue height into budget.
- Hit registry: TurnStatus stop, ScrollCue follow, tool expand, tasks kill (already patterned in `mouse.ts`).

### Focus model (phase 2)

Grok: Tab toggles prompt ↔ scrollback; letters in simple mode refocus prompt. CLAI can stay prompt-primary initially; add scrollback focus when selection/fold UX lands.

---

## 9. What NOT to copy

| Do not copy | Why |
|-------------|-----|
| **Rust / ratatui / crossterm** | CLAI is Node + Ink |
| **`xai-ratatui-textarea` / `xai-ratatui-inline`** | Different editor stack; use Ink input or a small TS multiline field |
| **True virtual scroll + sticky 1D math ports** | Port *behavior* (follow, sticky cue); reimplement simply |
| **Syntect / full-file edit HL worker** | Too heavy; theme-token diff coloring is enough |
| **Mermaid / inline ffmpeg media / OSC8 link maps** | Optional far-future |
| **ACP tracker as a crate** | Replicate ordering rules in `reduceUiEvent` |
| **Dashboard multi-agent roster** | Separate product surface; CLAI bench dashboard already exists |
| **Minimal mode terminal-native palette** | CLAI has `CLAI_NO_TUI` / headless instead |
| **OpenTUI / Zig** | **Not used** by grok-build. TUI is **ratatui**. OpenTUI appears only in comments (mouse accel / timing references). Architecture.md’s OpenTUI note is about **OpenCode**, not grok-build |
| **Grok themes (TokyoNight, RosePine, …) / magenta GrokNight as default** | Keep CLAI metallic language; optional theme switch later |
| **Vim mode key chord matrix wholesale** | Optional later; ship arrows + pgup/pgdn + esc first |
| **Personas / plugin CTA / credit bar / Mixpanel** | Product-specific |
| **Double Esc rewind / session picker** | Nice later; not required for ADE transcript fidelity |
| **Pixel-perfect glyph choices** | Match semantics; keep CLAI lifecycle icon set |

---

## 10. Suggested implementation slices (CLAI)

Ordered for incremental PRs; each stays behind UiBus:

1. **Transcript fidelity** — assistant restart after tools; optional thinking item; file_write item; suppress todo tool rows into PlanPane.
2. **TurnStatus row** — promote LifecycleLine; timers; idle hide; bg “still running”.
3. **Follow UX** — sticky user cue; follow indicator copy; page-flip or documented snap-on-send.
4. **Composer growth** — multiline + `/` palette stub.
5. **TasksPane** — bash_bg + task subagent rows.
6. **Edit diff expand** — unified diff in tool/file_write expand.
7. **Focus / fold** — scrollback selection, collapse all thinking, shortcuts bar dynamism.
8. **Layout compute module** — pure layout + compact breakpoints.

---

## 11. Source map (for implementers)

| Concern | Grok path |
|---------|-----------|
| Layout | `xai-grok-pager/src/views/agent.rs` (`AgentViewLayout`) |
| Draw orchestration | `.../app/agent_view/render.rs` |
| Chronology | `.../acp/tracker.rs` |
| Blocks | `.../scrollback/blocks/*`, `scrollback/block.rs` |
| Follow / sticky | `.../scrollback/state/nav.rs`, `scrollback/sticky.rs` |
| Turn status | `.../views/turn_status.rs` |
| Prompt | `.../views/prompt_widget/` |
| Todos / tasks | `.../views/todo_pane.rs`, `tasks_pane.rs` |
| Shortcuts / status | `.../views/shortcuts_bar.rs`, `agent_status.rs`, `context_bar.rs` |
| User docs | `.../docs/user-guide/01,03,16,20,23` + `tutorial/04-navigation.md` |

CLAI counterparts: `src/ui/app.tsx`, `components.tsx`, `state.ts`, `events.ts`, `theme.ts`, `mouse.ts`.

---

## 12. Success criteria

CLAI ADE feels “grok-like” when:

1. A turn’s user → thinking → tools → edits → assistant chunks appear **in the order they happened**, interleaved.
2. Follow mode keeps the live edge visible without trapping the user who scrolled up.
3. Running work is visible in **one** status row above the composer, not only buried in the transcript.
4. Plan/tasks are available without turning the first viewport into a dashboard.
5. Visual density stays quiet (metallic CLAI), with motion reserved for in-flight work.

Not required for success: ratatui parity, dashboard, vim mode, syntect diffs, or OpenTUI.
