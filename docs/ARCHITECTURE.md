# CLAI Architecture

**Unified Agentic Coding Harness (AE-01)** — single package `clai`, binary `clai`.

This document is a visual map of how CLAI is structured, how a run flows through it, and where it deliberately differs from frontier harnesses like [OpenCode](https://opencode.ai/).

---

## At a glance

| | **CLAI** | **OpenCode** (baseline peer) |
|---|---|---|
| **Shape** | Single TypeScript package, one CLI binary | Client/server micro-OS (TUI + worker + HTTP) |
| **Exploration** | Live tools first (rg, LSP, read) — no vector DB | Live tools + LSP; rules in `AGENTS.md` via `/init` |
| **Memory** | SQLite/JSON with provenance + invalidation | Session history; durable memory is convention/prompt |
| **Context** | Budgeted `assemble()` with real ablation gates | Compaction + prompt; no harness memory plane |
| **Done means** | Designed: `PASS \| FAIL \| BLOCKED` + evidence *(verify seam in progress)* | Model `stop` finish reason — tests are advisory |
| **Trace** | Append-only JSONL under `.clai/traces/<runId>/` | Session store + share links |
| **UI** | Ink ADE pane (`UiBus` → TUI or headless) | SolidJS/OpenTUI; event bus across threads |
| **Providers** | Vercel AI SDK registry (`src/adapter/providers.ts`) | 75+ via Models.dev |

---

## System diagram

```mermaid
flowchart TB
  subgraph Human["Human surface"]
    TUI["Ink ADE TUI<br/>activity · plan · approvals · strip"]
    Headless["Headless printer<br/>CLAI_NO_TUI=1 / CI"]
    UiBus["UiBus event API"]
    TUI --> UiBus
    Headless --> UiBus
  end

  subgraph CLI["clai CLI"]
    Entry["cli.tsx<br/>demo · intake · memory · run"]
  end

  subgraph Harness["Harness plane"]
  direction TB
    Adapter["adapter/<br/>AI SDK agent loop"]
    Context["context/<br/>budgeted assemble()"]
    Memory["memory/<br/>SQLite / JSON store"]
    Verify["verify/<br/>completion contract"]
    Trace["trace/<br/>JSONL writer"]
    Context --> Memory
    Adapter --> Context
    Adapter --> Verify
    Adapter --> Trace
  end

  subgraph Tool["Tool plane"]
  direction TB
    Tools["tools/<br/>grep · glob · read · edit · write · bash"]
    LSP["tools/lsp<br/>defs · refs · diagnostics"]
    Intake["tools/intake<br/>repo map JSON"]
    Sandbox["sandbox/<br/>approval + env scrub"]
    Tools --> Sandbox
    LSP --> Tools
    Intake --> Tools
  end

  subgraph External["External"]
    LLM["LLM providers<br/>Groq · Cerebras · Gemini · …"]
    Repo["Workspace / fixtures"]
    LspSrv["Language servers<br/>tsserver · pyright"]
  end

  Entry --> UiBus
  Entry --> Adapter
  Adapter <-->|"generateText + tools"| LLM
  Adapter --> Tools
  Tools --> Repo
  LSP --> LspSrv
  Trace -->|"events.jsonl"| Repo
  Memory -->|"`.clai/memory`"| Repo
```

---

## Two planes (core design choice)

CLAI splits **exploration** from **harness intelligence**. This is architecture, not a two-panel UI — the operator still sees one Pi/OpenCode-like terminal pane.

```mermaid
flowchart LR
  subgraph TP["Tool plane — explore like an engineer"]
    G["grep / glob"]
    R["read / edit / write"]
    B["bash (sandboxed)"]
    L["LSP"]
    I["repo_intake"]
  end

  subgraph HP["Harness plane — remember & bound context"]
    M["Memory tiers<br/>task · convention · evidence · preference"]
    C["ContextManager<br/>token budget · staleness · ablations"]
    V["Verification<br/>evidence · repair loop"]
    T["Trace<br/>what happened"]
  end

  TP -->|"tool results"| HP
  HP -->|"assembled prompt extras"| Adapter["Agent loop"]
  Adapter -->|"tool calls"| TP
```

| Plane | Job | **Not** its job |
|-------|-----|-----------------|
| **Tool** | Find and change code: ripgrep, LSP, bash, read/edit | Global AST index, vector search |
| **Harness** | Durable facts, bounded prompts, proof of work, audit trail | Replace grep/LSP for discovery |

**Rule:** exploratory discovery is never “search the memory table.” Memory cites paths; tools read the live repo.

---

## Run lifecycle

```mermaid
sequenceDiagram
  participant U as Operator
  participant UI as UiBus / TUI
  participant A as adapter loop
  participant C as ContextManager
  participant T as tools + sandbox
  participant LLM as Provider
  participant TR as trace JSONL

  U->>UI: clai run "fix the test"
  UI->>TR: run_start
  A->>C: assemble(task, budget, ablations)
  C-->>A: memory blocks + UNTRUSTED labels
  loop maxSteps
    A->>LLM: messages + tools
    LLM-->>A: text / tool_calls
    A->>UI: assistant_text / tool rows
    A->>TR: model_step
    opt tool call
      A->>T: grep · read · edit · bash · LSP
      T-->>A: structured result
      A->>TR: tool_call / tool_result
    end
  end
  Note over A,V: Target: verify → PASS|FAIL|BLOCKED<br/>Today: soft stop on model finish
  A->>TR: run_end
  UI->>U: footer + trace path
```

---

## Module seams (`src/`)

```
src/
├── cli.tsx           # Entry: demo, intake, memory CLI, run
├── adapter/          # Vercel AI SDK loop + provider registry
├── tools/            # Tool plane (parallel read-only where safe)
│   ├── intake.ts     # Repository map scanner
│   └── lsp.ts        # Definition / references / diagnostics
├── context/          # Budgeted prompt assembly + ablation gates
├── memory/           # Tiered store (sqlite | json fallback)
├── sandbox/          # @anthropic-ai/sandbox-runtime + stub fallback
├── verify/           # Completion contract (scaffold)
├── trace/            # Append-only JSONL per run
└── ui/               # Ink ADE shell + headless printer
```

### Storage boundaries (no dual-write)

```mermaid
flowchart LR
  JSONL["Session JSONL<br/>`.clai/traces/<runId>/events.jsonl`<br/><i>what happened</i>"]
  SQL["SQLite memory<br/><i>what we believe now</i>"]
  ASM["Ephemeral assemble()<br/><i>one turn's prompt slice</i>"]

  JSONL -.->|"provenance pointer only"| SQL
  SQL --> ASM
  ASM -->|"never persisted"| X["discarded after turn"]
```

| Store | Owns | Mutability |
|-------|------|------------|
| **JSONL trace** | Messages, tool calls, approvals, costs | Append-only |
| **Memory DB** | Conventions, evidence, task notes | Invalidate / supersede |
| **assemble()** | Prompt context for one model turn | Ephemeral |

Working memory (current file, last grep) lives in **JSONL / in-process state**, not SQLite.

---

## Context & memory (why it beats prompt-only harnesses)

```mermaid
flowchart TD
  Q["assemble(request)"] --> ABL{"Ablation gates"}
  ABL -->|memoryEnabled=false| SKIP["Exclude all memory"]
  ABL -->|structuralCitationsEnabled=false| NOCITE["Skip file slices"]
  ABL -->|both true| FULL["Full candidate set"]

  FULL --> STALE["Hash cite_path → invalidate stale rows"]
  STALE --> PRI["Priority: evidence → convention → task"]
  PRI --> BUD["Fill token budget"]
  BUD --> LABEL["Label UNTRUSTED_DATA vs TRUSTED_MEMORY"]
  LABEL --> OUT["systemExtras + excluded[] + staleInvalidations[]"]
```

**OpenCode** records build/test/lint hints in project rules (`AGENTS.md` from `/init`) and relies on the model to run them. **CLAI** adds:

1. **Queryable memory** with `source`, `tier`, and `superseded_by` for audit.
2. **Staleness gate** — cited files re-hashed at assemble time; stale claims invalidated automatically.
3. **Real ablations** — `memoryEnabled` and `structuralCitationsEnabled` are boolean gates, not “fetch everything then zero weights.”
4. **Injection resistance** — repo text and repo-derived memory enter the prompt inside `UNTRUSTED_DATA` blocks with an explicit safety rule.

---

## Tool plane

| Tool | Role | Notes |
|------|------|-------|
| `grep` | Ripgrep JSON → Node fallback | Parallel-safe read-only |
| `glob` | fast-glob patterns | Workspace-confined paths |
| `read` / `edit` / `write` | File I/O | Edit uses exact match |
| `bash` | Shell via sandbox | Approval for egress / destructive / out-of-repo |
| `lsp_*` | TS/Python navigation & diagnostics | Required for eval task set |
| `repo_intake` | Structured repo map | `clai intake` prints JSON |

All paths resolve under `workspaceRoot` — the harness cannot wander outside the fixture/repo.

---

## UI architecture

```mermaid
flowchart TB
  Producers["adapter · tools · sandbox · verify"]
  Bus["UiBus.emit(event)"]
  Reducer["reduceUiEvent → UiState"]
  Ink["Ink ClaiApp<br/>Header · Activity · Plan · Strip · Footer"]
  HL["headless formatHeadlessEvent"]

  Producers --> Bus
  Bus --> Reducer
  Reducer --> Ink
  Bus --> HL
```

One event stream, two renderers — interactive TTY gets the ADE pane; CI/pipes get the same semantics as plain lines. OpenCode uses a similar separation (worker thread vs TUI) but over RPC + a global event bus across a larger runtime.

---

## Verification: the biggest harness delta vs OpenCode

OpenCode’s session loop ends when the model emits `stop` with no pending tool calls. Tests, lint, and build are **prompt guidance**, not runtime predicates — a [known gap](https://github.com/anomalyco/opencode/issues/20873) with active proposals for verification gates.

CLAI’s **target contract** (see `verify/` + wayfinder spec):

```mermaid
stateDiagram-v2
  [*] --> Working
  Working --> Verify: edits complete
  Verify --> PASS: all checks green + evidence recorded
  Verify --> Repair: check failed
  Repair --> Working: bounded patch attempt
  Repair --> FAIL: budget exhausted
  Working --> BLOCKED: missing prereq / denied approval
  PASS --> [*]
  FAIL --> [*]
  BLOCKED --> [*]
```

| Criterion | OpenCode today | CLAI design |
|-----------|----------------|-------------|
| Terminal state | Model `stop` | `PASS \| FAIL \| BLOCKED` |
| Tests/lint/build | Model may skip | Required checks after final edit |
| Evidence | Tool stdout in history | Recorded verification artifacts in trace |
| Retry | Provider backoff; doom-loop on 3× identical calls | Bounded diagnose → patch → reverify |
| Step budget expiry | Summary prompt, not failure | `FAIL`, not success |

**Today:** the adapter uses *soft completion* (“stop when the task looks done”) while the `verify` seam is scaffolded. The architecture above is the intentional upgrade path.

---

## Provider adapter

```mermaid
flowchart LR
  ENV["CLAI_PROVIDER · CLAI_MODEL · API keys"]
  REG["providers.ts registry"]
  SDK["Vercel AI SDK generateText"]
  LOOP["runAgentLoop()"]

  ENV --> REG
  REG --> SDK
  SDK --> LOOP
```

Add or remove providers in one file without touching the loop. Heavy natives (`better-sqlite3`, `sandbox-runtime`) are **lazy-imported** so `clai --help` stays fast — including on Windows ARM where natives may be absent (stub sandbox, JSON memory fallback).

---

## Side-by-side: when CLAI is the better harness

### CLAI wins on

| Area | Why |
|------|-----|
| **Eval reproducibility** | JSONL traces + ablation flags + memory provenance → judges can replay *what the harness believed* |
| **Honest completion** | Verification contract aims for evidence-based `PASS`, not “model stopped talking” |
| **Context discipline** | Token budget, staleness invalidation, injection labels — not just compaction |
| **Simplicity** | One package, clear seams (`adapter` / `tools` / `memory` / `context` / `trace`) |
| **Offline demos** | `clai demo`, `clai demo lsp`, `clai intake` — no API key required |
| **Platform pragmatism** | Optional deps + stub fallbacks; install succeeds even without C++ toolset |

### OpenCode wins on

| Area | Why |
|------|-----|
| **Surface area** | Terminal + desktop + IDE extensions from one backend |
| **Provider breadth** | 75+ models, Copilot/ChatGPT OAuth, Zen curated models |
| **Maturity** | Permission rulesets, sub-agents, multi-session, huge community |
| **Permission UX** | Tiered allow/ask/deny with glob patterns and doom-loop detection |

CLAI is not trying to clone OpenCode’s product surface — it studies Pi/OpenCode TUI patterns and ships an **original harness** optimized for **verification, memory, and judge-grade traces** on a Terminal-Bench-style loop.

---

## Quick commands (architecture in motion)

```bash
pnpm install
cp .env.example .env          # provider keys

pnpm clai --help              # light entry (lazy heavy imports)
pnpm clai demo                # offline tool plane: edit + bash
pnpm clai demo lsp            # intake + LSP diagnostics
pnpm clai intake --cwd .      # repo map JSON
pnpm clai memory list         # harness plane store
CLAI_NO_TUI=1 pnpm clai run "…"  # headless trace stream
```

Trace artifact: `.clai/traces/<runId>/events.jsonl`

---

## References

- Repo agent guide: [`AGENTS.md`](../AGENTS.md)
- Memory & context spec: [`.scratch/wayfinder-bodies/memory-context-architecture.md`](../.scratch/wayfinder-bodies/memory-context-architecture.md)
- OpenCode peer verification note: [`.scratch/wayfinder-bodies/assets/06-peer-verify-opencode.md`](../.scratch/wayfinder-bodies/assets/06-peer-verify-opencode.md)
- Wayfinder map (ticket spine): [GitHub issue #1](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/1)
