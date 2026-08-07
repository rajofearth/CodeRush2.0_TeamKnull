# Grok Build → CLAI UI Adaptation Brief

Design brief for adapting [xai-org/grok-build](https://github.com/xai-org/grok-build) terminal UI patterns into CLAI’s Ink ADE shell. **Adapt patterns, do not port Rust.**

**Source studied:** `xai-grok-pager` (ratatui TUI). CLAI implements the information architecture in Ink/`UiBus`.

## Agent screen stack (adapted)

```text
┌─ header: CLAI · session chips · cwd ─────────────────────────────────┐
│  [sticky › user prompt when scrolled]                                 │
│  SCROLLBACK (windowed Activity)                                       │
│  [▼ follow live]                                                      │
│  turn status (LifecycleLine + elapsed)                                │
│  [plan / approvals / tasks panes]                                     │
│  PROMPT COMPOSER                                                      │
│  shortcuts / context strip · credit                                   │
└───────────────────────────────────────────────────────────────────────┘
```

## Chronological transcript rules

1. Append in appearance order; mutate by id; never bucket tools vs chat.
2. New assistant segment after each tool boundary (`turn-N-sK`).
3. Optional thinking blocks when the provider emits reasoning via `fullStream`.
4. Write/edit show path + human bytes inline; `toolCallStreaming` surfaces “preparing write …” while args generate.
5. Plan/todo refresh the plan pane, not noisy tool spam when possible.

## What we do not copy

ratatui/crossterm, syntect workers, multi-agent dashboard, Grok branding, OpenTUI (grok-build does not use it; CLAI stays on Ink + Node ≥20).
