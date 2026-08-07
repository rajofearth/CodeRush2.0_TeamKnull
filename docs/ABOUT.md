# About CLAI

**CLAI** (AE-01, *by team knull*) is a terminal-first, single-package **unified agentic coding
harness**. It explores code with live tools (ripgrep, glob, read, LSP, bash), remembers across
sessions with a tiered memory store, verifies work against a completion contract, and records
judge-grade traces of everything it did — all behind one binary: `clai`.

This document is the "who and why": what CLAI is, what it believes, and what it ships.
For the deep system map, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## What CLAI is

- **One package, one binary.** TypeScript, ESM, Node ≥ 20. No daemon, no client/server split,
  no plugin marketplace to assemble. `pnpm clai` is the whole surface.
- **A harness, not a model.** CLAI wraps any LLM behind the [Vercel AI SDK](https://ai-sdk.dev/)
  and adds the parts models can't do alone: durable memory, bounded context, proof of work, and
  an audit trail.
- **Terminal-first.** The default face is an Ink ADE pane — activity column, plan, approvals,
  context strip — with a headless printer for CI and pipes (`CLAI_NO_TUI=1`).

## What CLAI believes

1. **Live tools first.** Discovery happens through `grep` / `glob` / `read` / LSP /
   `repo_intake` — never through a search index over the memory table. The repo is the source
   of truth; memory only *cites* paths.
2. **Two planes.** *Exploration* (finding and changing code) and *harness intelligence*
   (durable facts, bounded prompts, proof of work, audit trail) are deliberately separated.
   The harness plane never replaces grep or LSP.
3. **Done means verified.** A task isn't finished when the model stops — it's `PASS`, `FAIL`,
   or `BLOCKED`, backed by evidence from a completion contract.
4. **Everything is recorded.** Every run leaves an append-only trace: model steps, tool calls
   and results, metrics. If it can't be replayed, it didn't happen.

## What CLAI does

| Surface | What it does |
|---------|--------------|
| `clai` / `clai <folder>` | Interactive Ink session on a workspace root |
| `clai run "<prompt>"` | Soft agent loop: tools, edits, verification (needs a provider key) |
| `clai chat "<prompt>"` | Same loop with verbose logging — tools, I/O, tokens, cost |
| `clai demo` | Offline edit+bash happy path on `fixtures/tiny-edit` — no API key |
| `clai demo lsp` | Offline repo intake + TypeScript diagnostics on `fixtures/lsp-ts` |
| `clai demo injection` | Memory/context assembly demo |
| `clai intake` | Print the repository intake map as JSON |
| `clai memory …` | Tiered memory store: `list`, `get`, `set`, `delete`, `export` |
| `clai bench …` | Built-in benchmark suite + live SSE dashboard on port **4310** |

### The agent loop

A session is a loop, not a one-shot call:

```
explore → plan → edit → verify → repair → done
```

Lifecycle states are surfaced in the TUI as `●` working, `◐` verify, `✓` PASS, `↻` repair,
`✗` FAIL, `⊘` BLOCKED. Producers emit `UiEvent`s onto a `UiBus`; the Ink shell and the
headless printer are interchangeable subscribers.

## Architecture at a glance

```
bin/clai.js              # npm bin shim
src/
├── cli.tsx              # entry: launch, run, demo, intake, memory, bench
├── workspace.ts         # workspace root resolution + argv parsing
├── adapter/             # AI SDK loop, provider registry, retry, .env loading
├── agents/              # `task` subagents (explore = read-only, general = +bash)
├── tools/               # grep, glob, read, edit, write, bash, LSP, intake + limits
├── context/             # budgeted assemble() + deterministic history compaction
├── memory/              # SQLite/JSON tiered store + CLI
├── sandbox/             # @anthropic-ai/sandbox-runtime wrap + stub fallback, env scrub
├── verify/              # completion contract — PASS | FAIL | BLOCKED
├── trace/               # append-only JSONL per run
├── bench/               # runner, SSE server, store, live dashboard
└── ui/                  # Ink ADE shell, UiBus events, headless printer, theme
```

Key seams:

| Path | Role |
|------|------|
| `src/adapter/` | Vercel AI SDK loop; pluggable providers; multi-tool-call parallelism |
| `src/tools/` | grep/glob/read/edit/write/bash, `parallel`, background shell jobs, LSP, intake |
| `src/context/` | Budgeted context assembly + deterministic history compaction |
| `src/memory/` | Tiered memory (SQLite/JSON) with provenance, TTL, invalidation |
| `src/trace/` | Append-only JSONL under `.clai/traces/<runId>/events.jsonl` |
| `src/ui/` | Ink ADE shell + headless printer over a shared `UiBus` |
| `docs/GROK-BUILD-UI-ADAPTATION.md` | How to adapt grok-build TUI patterns into CLAI’s Ink shell |

## What CLAI leaves behind

Every run writes artifacts under the workspace data dir (`<root>/.clai` or `CLAI_DATA_DIR`):

| Artifact | Path | Purpose |
|----------|------|---------|
| Trace | `.clai/traces/<runId>/events.jsonl` | Append-only audit trail: model steps, tool calls/results, metrics |
| Memory | `.clai/memory` | Tiered store with provenance, TTL, and invalidation |
| Bench history | `.clai/bench/history.jsonl` | All benchmark runs, fed to the live dashboard |

## Providers

CLAI speaks to LLMs through the Vercel AI SDK; providers are registered in one place
(`src/adapter/providers.ts`) — adding one never touches the agent loop. Supported today:
groq, openrouter, cerebras, openai, anthropic, gemini, gateway, deepseek.
`CLAI_PROVIDER` selects, `CLAI_MODEL` overrides the model id. Never commit `.env`.

## Quick start

```bash
pnpm install
cp .env.example .env     # add a provider key
pnpm clai --help
pnpm clai demo           # offline demo — no API key needed
pnpm clai                # interactive session on the current directory
pnpm clai run "fix the failing test"   # soft agent loop (needs a provider key)
```

## See also

- [`docs/CLAI-AGENT.md`](CLAI-AGENT.md) — the agent itself: tool belt, habits, task workflow
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — system + sequence diagrams, run lifecycle, seams
- [`AGENTS.md`](../AGENTS.md) — agent guide: commits, quick start, provider table, platform notes
- [`src/ui/README.md`](../src/ui/README.md) — TUI visual language, theme tokens, lifecycle states
- [`README.md`](../README.md) — the top-level readme
