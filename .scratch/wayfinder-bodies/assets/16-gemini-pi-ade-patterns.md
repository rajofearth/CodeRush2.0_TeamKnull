# Gemini CLI + Pi ADE patterns for CLAI (study only — do not clone)

Companion to `07-tui-look.md` and `07-opencode-tui-patterns.md`. Sources: public trees of [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) (`packages/cli/src/ui`) and [earendil-works/pi](https://github.com/earendil-works/pi) (`packages/tui`, `packages/coding-agent`). No vendoring.

## Gemini CLI — composition (Ink)

| Piece | Path / role |
|-------|-------------|
| Root | `App.tsx` → `DefaultAppLayout` / screen-reader layout |
| Layout | `MainContent` (history) + `Composer` (input stack) + `DialogManager` + `Footer` |
| Scroll | `ScrollableList` / `VirtualizedList`; alt-buffer mode draws a scrollbar; `AppEvent.ScrollToBottom` |
| History | `HistoryItemDisplay` routes typed items (user, gemini, `tool_group`, thinking, stats, …) |
| Tools | `ToolGroupMessage` → `ToolMessage` / `DenseToolMessage` / `ShellToolMessage`; compact vs expanded payload; `isExpandable` after last user prompt |
| Input | `InputPrompt` + `Composer`; slash commands via `ui/commands/*` |
| Model | `/model` → `ModelDialog`; `/model set <id> [--persist]` |
| Quota | `ModelQuotaDisplay`, `QuotaDisplay`, `ProQuotaDialog` (retry once / switch fallback / stop / upgrade) |

**Steal for CLAI (minimal):**

1. **Expandable tool rows** — collapsed one-liner by default; toggle reveals args/stdout (ctrl+o or enter on focused row). Gemini’s `tool_group` + compact allowlist is the UX, not the code.
2. **Slash model switch** — `/model` list + set, env still wins as default; footer shows active `provider/model`.
3. **Quota soft-fail** — detect TPM/RPM 429; status line “rate limited · retry in Ns”; optional one auto-retry with backoff; if still failing, inline choice: retry / stop (no upgrade upsell).
4. **Scroll stickiness** — keep pgup/pgdn; auto-stick to bottom on new assistant/tool unless user scrolled up (Gemini’s scroll-to-end on confirm).
5. **Composer queue** — while busy, allow typing next prompt into a queue (Gemini `QueuedMessageDisplay`) — nice-to-have after expand + model.

**Do not steal:** auth dialogs, session browser, theme packs, ASCII splash, Pro upsell, MCP status screens, full dialog manager surface.

## Pi — composition (own TUI, not Ink)

Pi ships `@earendil-works/pi-tui`: differential rendering, main vs alt screen, `ScrollView` with follow-end, `Editor` with paste + autocomplete, overlays for selects. Coding-agent has `model-registry`, `list-models`, session picker, slash commands.

**Steal for CLAI (behavioral only):**

1. Follow-end scroll until user navigates up.
2. Bracketed paste / multi-line input (Ink limitation — approximate with paste buffer or keep single-line MVP).
3. Model list as first-class (env + interactive), not only `.env`.
4. Keep CLAI on **Ink** (map Notes); do not adopt pi-tui.

## CLAI today vs gap

| Behavior | CLAI now | Gap |
|----------|----------|-----|
| Scroll | pgup/pgdn / ctrl+u/d windowing | No stickiness flag; no mouse |
| Input | single-line `InputLine`, blocked while busy | No slash cmds; no queue; no history ↑ |
| Tool expand | `ToolGroup` always shows all rows; detail truncated | No collapse/expand of args/output |
| Model | footer display only; `CLAI_PROVIDER`/`CLAI_MODEL` env | No `/model`; no Gemini provider |
| Rate limit | loop dies / status error (Groq TPM) | No backoff, no retry dialog, no quota strip |
| Approvals | `ApprovalPrompt` renders y/n copy | **Not wired** — no y/n in `useInput`; live run lacks sandbox `onApproval` bridge |
| Interrupt | Esc sets soft flag | Does not abort in-flight `generateText` |

## Explorer deltas (post-research)

Consolidated from CLAI audit, Gemini CLI Ink pass, Pi TUI pass:

- **Ctrl+O** (Gemini): lift height caps + expand last-turn tool callIds; dense one-liner → capped body; collapsed shows **tail**, not head.
- **Sticky dock** (Gemini Composer / Pi fullscreen): status + input + footer fixed; only activity scrolls.
- **Retry UX** (Pi): `Retrying (n/max) in Xs… (Esc to cancel)` countdown; Gemini: retry / switch model / stop after exhaustion.
- **Busy input** (Pi): queue/steer instead of hard `readOnly`; CLAI currently locks input while busy.
- **Approvals**: wire y/n + `onApproval` before polish feels “interactive.”

## Provider note (user preference this session)

- Add **`gemini`** to `src/adapter/providers.ts` via `@ai-sdk/google` (or OpenAI-compatible Gemini endpoint if SDK pin forces it).
- Default model preference: **`gemini-3.5-flash-lite`** (confirm exact id against Google model list at implement time).
- Env: `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`; never commit keys.
- Map Notes still list OpenAI/Anthropic for hackathon — update Notes when Gemini lands.

## Out of scope (unchanged)

Fork/copy Gemini CLI or Pi; full settings/theme/session browser; parity with their command catalogs.
