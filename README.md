# CLAI — Unified Agentic Coding Harness

> **CLAI** (AE-01, *by team knull*) is a terminal-first, single-package agentic coding harness.
> It explores your code with live tools (ripgrep, LSP, bash), remembers across sessions with
> a tiered memory store, verifies work against a completion contract, and records judge-grade
> traces of everything it did — all behind one binary: `clai`.

- **One package, one binary.** TypeScript, ESM, Node ≥ 20. No daemon, no client/server split.
- **Live tools first.** Discovery happens through `grep` / `glob` / `read` / LSP / `repo_intake` — never through a search index over the memory table.
- **Harness intelligence.** Budgeted context assembly, deterministic history compaction, tiered memory with provenance, append-only traces, and a built-in 8-task benchmark with a live dashboard.
- **Ink TUI.** A brushed-steel terminal pane (activity column, plan, approvals, context strip) with a headless printer for CI/pipes (`CLAI_NO_TUI=1`).

---

## Quick start

```bash
pnpm install
cp .env.example .env     # add a provider key (see Providers)
pnpm clai --help
pnpm clai demo           # offline edit+bash demo — no API key needed
```

### Launch a session

```bash
pnpm clai                      # interactive session on the current directory
pnpm clai <folder>             # session on a specific workspace
pnpm clai run "fix the failing test"   # soft agent loop (needs a provider key)
pnpm clai chat "how does the bench runner work?"  # verbose log-mode session
```

### Try it without an API key

```bash
pnpm clai demo               # offline edit + bash on fixtures/tiny-edit
pnpm clai demo lsp           # offline repo intake + TS diagnostics on fixtures/lsp-ts
pnpm clai demo injection     # memory/context assembly demo
pnpm clai intake --cwd .     # print the repository intake map (JSON)
pnpm clai bench run --offline --serve   # 8-task offline benchmark + dashboard on :4310
```

---

## CLI reference

```
clai [<folder>] [--cwd <path>]        Launch the interface on a workspace root (default: cwd)
clai --help                            Light entry (heavy imports are lazy)
clai demo [--fixture <path>]           Offline edit+bash happy path (no API key)
clai demo lsp [--fixture <path>]       Offline intake + LSP diagnostics demo
clai demo injection [--data-dir <path>] Memory/context injection demo
clai intake [--cwd <path>]             Print repository intake map (JSON)
clai memory list|get|set|delete|export Harness memory store CLI
clai bench run|serve|list              Benchmark runner + live dashboard
clai chat ["<prompt>"] [--cwd <path>]  Verbose log-mode session — tools, I/O, tokens, cost
clai run "<prompt>" [--cwd <path>]     Soft agent loop via the AI SDK (needs a key)
clai --fixture <path>                  Run the demo on a custom fixture workspace
```

| Command | API key | What it does |
|---------|---------|--------------|
| `clai` / `clai <folder>` | yes | Interactive Ink session on the workspace root |
| `clai run "<prompt>"` | yes | Single-turn (headless) or first-turn + interactive (TTY) agent loop |
| `clai chat` | yes | Same loop with verbose logging — tools, I/O, tokens, cost |
| `clai demo` | no | Offline edit+bash on `fixtures/tiny-edit` |
| `clai demo lsp` | no | Offline intake + LSP diagnostics on `fixtures/lsp-ts` |
| `clai demo injection` | no | Red-team memory/context assembly demo |
| `clai intake` | no | Print the repository intake map as JSON |
| `clai memory …` | no | Tiered memory store: `list`, `get <id>`, `set <tier> <content>`, `delete <id>`, `export` |
| `clai bench run` | optional | Parallel 8-task benchmark; `--offline` patches fixtures with `_solution/` files |
| `clai bench serve` | no | Live SSE dashboard over bench history (default port **4310**) |
| `clai bench list` | no | List the benchmark tasks |

### Workspace resolution

A bare first word matching `run`, `chat`, `demo`, `intake`, `memory`, `bench`, or `help` is a
**subcommand**; anything else is a **workspace folder**. If a folder shares a subcommand name,
disambiguate with `clai -- demo` or `clai --cwd demo`. `--cwd` always wins over a positional path.

The resolved root governs the tool cwd, trace paths, the memory store, and intake scans —
there is no scattered `process.cwd()` logic.

---

## Providers

CLAI speaks to LLMs through the [Vercel AI SDK](https://ai-sdk.dev/). Providers are registered
in one place (`src/adapter/providers.ts`) — adding one never touches the agent loop.
Default provider: **groq** (`DEFAULT_PROVIDER`).

| Env var | `CLAI_PROVIDER` | Default model |
|---------|-----------------|---------------|
| `GROQ_API_KEY` | `groq` *(default)* | `openai/gpt-oss-20b` |
| `OPENROUTER_API_KEY` | `openrouter` | `google/gemma-4-31b-it:free` |
| `CEREBRAS_API_KEY` | `cerebras` | *registry default* |
| `OPENAI_API_KEY` | `openai` | *registry default* |
| `ANTHROPIC_API_KEY` | `anthropic` | *registry default* |
| `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY`) | `gemini` | `gemini-3.5-flash-lite` |
| `AI_GATEWAY_API_KEY` (or `VERCEL_AI_GATEWAY_API_KEY`) | `gateway` | `google/gemma-4-31b-it` |
| `DEEPSEEK_API_KEY` | `deepseek` | `deepseek-v4-flash` |

`CLAI_MODEL` overrides the model id for any provider. Example:

```bash
CLAI_PROVIDER=deepseek CLAI_MODEL=deepseek-v4-flash pnpm clai run "…"
```

### Other environment variables

| Env var | Effect |
|---------|--------|
| `CLAI_PROVIDER` | Provider id: `groq` \| `openrouter` \| `cerebras` \| `openai` \| `anthropic` \| `gemini` \| `gateway` \| `deepseek` |
| `CLAI_MODEL` | Model id override |
| `CLAI_AUTO_APPROVE=1` | Auto-approve gated bash (dev only) |
| `CLAI_NO_TUI=1` | Headless activity printer (CI / pipes / non-TTY) |
| `CLAI_NO_INTRO=1` | Skip the launch intro animation |
| `CLAI_DATA_DIR` | Override the harness data directory (default `<workspace>/.clai`) |
| `CLAI_LSP_PY` | Optional Python language-server binary for pyright |
| `NO_COLOR` / `CLAI_COLOR` / `FORCE_COLOR` | Color depth overrides (respects `chalk.level`) |

> Never commit `.env`. `.env.example` is the template.

---

## What CLAI produces

Every run leaves artifacts under the workspace data dir (`<root>/.clai` or `CLAI_DATA_DIR`):

| Artifact | Path | Purpose |
|----------|------|---------|
| Trace | `.clai/traces/<runId>/events.jsonl` | Append-only audit trail: model steps, tool calls/results, metrics |
| Memory | `.clai/memory` | Tiered store (SQLite/JSON) with provenance, TTL, and invalidation |
| Bench history | `.clai/bench/history.jsonl` | All benchmark runs, fed to the live dashboard |

```bash
pnpm clai memory list                       # what the harness remembers
pnpm clai memory set convention '{"message":"use pnpm"}' --cite package.json
pnpm clai memory export --output memory.jsonl
```

---

## Design: two planes

CLAI splits **exploration** from **harness intelligence** — architecture, not a two-panel UI.

| Plane | Job | **Not** its job |
|-------|-----|-----------------|
| **Tool** (`src/tools/`) | Find and change code: ripgrep, LSP, bash, read/edit/write, repo intake, task subagent | Global AST index, vector search |
| **Harness** (`src/context/`, `src/memory/`, `src/verify/`, `src/trace/`) | Durable facts, bounded prompts, proof of work, audit trail | Replace grep/LSP for discovery |

**Rule:** exploratory discovery is never "search the memory table." Memory cites paths;
tools read the live repo.

---

## Project layout

```
bin/clai.js              # npm bin shim
src/
├── cli.tsx              # entry: launch, run, demo, intake, memory, bench
├── workspace.ts         # workspace root resolution + argv parsing
├── adapter/             # AI SDK loop, provider registry, retry, .env loading
├── agents/              # read-only `task` subagent
├── tools/               # grep, glob, read, edit, write, bash, LSP, intake + limits
├── context/             # budgeted assemble() + deterministic history compaction
├── memory/              # SQLite/JSON tiered store + CLI
├── sandbox/             # @anthropic-ai/sandbox-runtime wrap + stub fallback, env scrub
├── verify/              # completion contract — PASS | FAIL | BLOCKED (scaffolded)
├── trace/               # append-only JSONL per run
├── bench/               # 8-task runner, SSE server, store, live dashboard
└── ui/                  # Ink ADE shell, UiBus events, headless printer, theme
fixtures/                # tiny-edit, lsp-ts, red-team-readme + 8 bench tasks
docs/ARCHITECTURE.md     # deep-dive: diagrams, run lifecycle, seams, OpenCode comparison
```

---

## Benchmark suite

`fixtures/bench/` ships 8 task fixtures, each with a `task.json` spec and a `check.mjs`
verification script (solutions live in `_solution/`):

`fix-async-race` · `fix-broken-import` · `fix-json-config` · `fix-test-assertion` ·
`implement-slugify` · `off-by-one` · `refactor-report` · `validate-quantity`

```bash
pnpm clai bench list                      # show the tasks
pnpm clai bench run --offline             # offline pass (no API key, applies _solution/)
pnpm clai bench run --parallel 3          # live run, 3 concurrent tasks
pnpm clai bench run --offline --serve     # run + keep the dashboard on :4310
```

---

## Interface

The TUI is an Ink ADE pane with a **metallic silver / matte black** visual language — saturated
color is reserved for lifecycle states. Producers emit `UiEvent`s onto a `UiBus`; the Ink shell
and the headless printer are interchangeable subscribers.

| State | Icon |
|-------|------|
| Working | `●` |
| Verify | `◐` |
| PASS | `✓` |
| Repair | `↻` |
| FAIL | `✗` |
| BLOCKED | `⊘` |

Details in [`src/ui/README.md`](src/ui/README.md).

---

## Platform notes

`better-sqlite3` and `@anthropic-ai/sandbox-runtime` are **optionalDependencies**. On hosts
without matching native builds (e.g. Windows ARM64, or no VS C++ toolset), `pnpm install` still
succeeds and `pnpm clai --help` / `pnpm clai demo` work — the sandbox falls back to a structured
stub. Memory tickets need a working sqlite binary (x64 Node + VS Build Tools *Desktop development
with C++*, or a platform with prebuilds).

---

## Documentation index

| Doc | What's inside |
|-----|---------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System + sequence diagrams, module seams, run lifecycle, memory/context design, OpenCode comparison |
| [`AGENTS.md`](AGENTS.md) | Agent guide: commit conventions, quick start, provider table, platform notes |
| [`src/ui/README.md`](src/ui/README.md) | TUI visual language, theme tokens, lifecycle state machine |

## Contributing

This repo follows [Conventional Commits](https://www.conventionalcommits.org/):
`feat:` · `fix:` · `docs:` · `refactor:` · `chore:` (see `AGENTS.md` for the full table).
The ticket spine and architecture map live on GitHub:
[CodeRush2.0_TeamKnull #1](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/1).
