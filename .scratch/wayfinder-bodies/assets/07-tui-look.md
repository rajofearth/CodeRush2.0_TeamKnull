# CLAI TUI Look & Feel — Locked

Companion to `07-trace-viewer-ux-rec.md`. Reference points: OpenCode (screenshot) and Pi — both single-pane terminal coding agents.

## 1. Live TUI = single composition, not a dashboard

CLAI's Ink UI is **one dark, dense, monospaced pane** in the OpenCode/Pi idiom:

- **Main column (left, dominant):** chronological activity — user prompt, assistant text, tool invocations as compact one-line rows (tool, target, duration, ok/fail), grouped/collapsible explore + file-read lists.
- **Context strip (right, narrow):** run title, tokens used, context window %, cost, MCP servers, LSP servers, cwd, version. Plain label/value lines — no boxes, no cards, no borders-as-decoration.
- **Footer (full width):** agent + model on the left, key hints on the right (`esc` interrupt, `tab` switch, `ctrl+p` palette), plus `runId`.

Rules: no ASCII art frames, no multi-panel splits beyond the strip, no spinners competing for attention, color used only for status (ok/fail/pending) and dim-for-secondary. "Zen" = whitespace and alignment doing the work, not chrome. Degrade gracefully at narrow widths by dropping the context strip, never by reflowing the activity log.

## 2. Judge trace stays out of the TUI

The reviewer surface is **not** a second live panel. It remains a static, self-contained `trace.html` generated from `events.jsonl` (see `07-trace-viewer-ux-rec.md`). The TUI's only tie-in is a footer hint: `trace: clai trace <runId> --html`. This keeps one live pane, one artifact, and no dual-write recording path.

## 3. What we do NOT copy

- No forking, vendoring, or line-lifting of OpenCode or Pi source. Convergent terminal-UI conventions (activity log + status strip + hint footer) are fine; their implementation is not.
- No brand assets: logos, wordmarks, ASCII splash, exact color palettes, or their command naming/branding.
- No cloning their feature surface for parity's sake (session switchers, plugin systems, share links) — CLAI ships only what its own tickets need.
- No screenshots of their product in submission materials as if they were ours.

Ours by construction: verification-gated task graph, memory/context provenance, and the exportable evidence bundle — none of which the peers surface.

## 4. Information architecture for the Ink app (sections only)

- `<App>` — root, owns run state subscription over the event stream.
- `<Activity>` — scrollback list; renders typed event rows.
  - `<UserTurn>` / `<AssistantText>` (streaming)
  - `<ToolRow>` — one line: icon/status, tool, target, duration
  - `<ToolGroup>` — collapsible cluster (explore, batched reads)
  - `<PlanBlock>` — current plan + revision marker
  - `<ApprovalPrompt>` — inline gate for write/bash
  - `<VerifyResult>` — pass/fail + one-line pointer to full log
- `<ContextStrip>` — title, tokens, context %, cost, MCP, LSP, cwd, version; also memory-injected/dropped counts.
- `<Footer>` — agent/model, shortcut hints, `runId`.
- `<Input>` — prompt line with history and `ctrl+p` palette.

Layout primitives only (Ink `Box`/`Text`, flex direction, dim/bold/color). No component-level styling system, no theme abstraction for MVP.
