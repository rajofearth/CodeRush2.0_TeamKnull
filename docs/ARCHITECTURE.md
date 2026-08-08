# CLAI Architecture

**Unified Agentic Coding Harness (AE-01)** — single TypeScript package `clai`, binary `clai`.

This document is the structural and behavioral map of CLAI: how components connect, how a run flows end-to-end, and where the harness deliberately differs from frontier peers like [OpenCode](https://opencode.ai/).

---

## Contents

| Section | What you'll find |
|---------|------------------|
| [At a glance](#at-a-glance) | Peer comparison table |
| [Complete harness flow](#complete-harness-flow) | **Master diagram** — every major path in one view |
| [System overview](#system-overview) | Layered component map |
| [Two planes](#two-planes-core-design-choice) | Tool plane vs harness plane |
| [Workspace model](#workspace-model) | Root resolution and `.clai/` layout |
| [CLI entry points](#cli-entry-points) | Commands and lazy loading |
| [Run lifecycle](#run-lifecycle) | Interactive, bench, and demo paths |
| [Storage boundaries](#storage-boundaries) | What persists vs what is ephemeral |
| [Provider adapter](#provider-adapter) | Registry, retry, model resolution |
| [Tool plane](#tool-plane) | Tools, subagents, caps, LSP |
| [Context & memory](#context--memory) | Compaction, assembly, tiers |
| [Sandbox](#sandbox) | Runtime, stub, approvals |
| [Trace & glass](#trace--glass) | JSONL events and observability |
| [UI architecture](#ui-architecture) | UiBus and renderers |
| [Benchmark system](#benchmark-system) | 81-task suite and compare races |
| [Verification](#verification-the-biggest-harness-delta-vs-opencode) | Target completion contract |
| [Demos & fixtures](#demos--fixtures) | Offline workspaces |
| [Environment variables](#environment-variables) | Configuration reference |
| [Platform notes](#platform-notes) | Optional deps and fallbacks |
| [When CLAI wins](#when-clai-wins) | Side-by-side with OpenCode |
| [Quick commands](#quick-commands) | Copy-paste starters |

---

## At a glance

| | **CLAI** | **OpenCode** (baseline peer) |
|---|---|---|
| **Shape** | Single TypeScript package, one CLI binary | Client/server micro-OS (TUI + worker + HTTP) |
| **Exploration** | Live tools first (rg, LSP, read) — no vector DB | Live tools + LSP; rules in `AGENTS.md` via `/init` |
| **Memory** | SQLite/JSON with provenance + invalidation | Session history; durable memory is convention/prompt |
| **Context** | Budgeted `assemble()` + deterministic history compaction | Compaction + prompt; no harness memory plane |
| **Subagents** | `task` tool — `explore` (read-only) / `general` (+bash); bounded summary return | Sub-agents, multi-session |
| **Benchmarks** | Built-in 81-task bench + live SSE dashboard + CLAI vs pi vs Codex compare | Community evals; no first-party harness bench |
| **Done means** | Designed: `PASS \| FAIL \| BLOCKED` + evidence *(verify seam scaffolded)* | Model `stop` finish reason — tests are advisory |
| **Trace** | Append-only JSONL under `.clai/traces/<runId>/` | Session store + share links |
| **UI** | Ink ADE pane (`UiBus` → TUI, headless, or `clai chat` log) | SolidJS/OpenTUI; event bus across threads |
| **Providers** | Vercel AI SDK registry (`src/adapter/providers.ts`) | 75+ via Models.dev |

---

## Complete harness flow

The diagram below is the **single end-to-end map** of CLAI. Follow it top-to-bottom for any path — interactive session, `clai chat`, bench run, or offline demo. Solid arrows are the hot path; dashed arrows are optional, parallel, or scaffolded.

```mermaid
flowchart TB
  classDef entry fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe
  classDef harness fill:#3b2f4a,stroke:#c084fc,color:#f3e8ff
  classDef tool fill:#1a3a2e,stroke:#34d399,color:#ecfdf5
  classDef persist fill:#3d2e1a,stroke:#fbbf24,color:#fef3c7
  classDef external fill:#2d2d2d,stroke:#94a3b8,color:#f1f5f9
  classDef ui fill:#1e293b,stroke:#38bdf8,color:#e0f2fe
  classDef scaffold fill:#374151,stroke:#9ca3af,color:#f9fafb,stroke-dasharray: 5 5

  subgraph ENTRY["① Entry & routing"]
    direction TB
    ARGV["argv · parseEntry()"] --> ROUTE{"Route"}
    ROUTE -->|interactive| LAUNCH["clai · clai run · clai chat"]
    ROUTE -->|offline| DEMO["clai demo · demo lsp · demo injection"]
    ROUTE -->|inspect| UTIL["intake · memory · glass"]
    ROUTE -->|eval| BENCHCLI["clai bench run · serve · list"]
    ROUTE -->|help| HELP["--help · lazy imports only"]
  end

  subgraph WS["② Workspace anchor"]
    direction TB
    PARSE["--cwd · positional folder · tie-breaker rules"]
    PARSE --> ROOT["Workspace.root · absolute path"]
    ROOT --> DATA[".clai/ or CLAI_DATA_DIR"]
    DATA --> ARTIFACTS["traces/ · memory · bench/"]
  end

  subgraph BOOT["③ Session bootstrap"]
    direction TB
    ENV["loadEnvFiles() · provider keys"]
    LAZY["lazy-import adapter · sandbox · bench · memory"]
    TRACE0["createTraceWriter · runId · run_start"]
    UIB["UiBus · TUI · chat log · headless · session.jsonl"]
    INTAKE0["ensureIntake once · repo map seed"]
    LSP0["probeLspAvailability · context strip"]
    ENV --> LAZY --> TRACE0
    TRACE0 --> UIB
    TRACE0 --> INTAKE0 --> LSP0
  end

  subgraph TURN["④ User turn loop"]
    direction TB
    USERIN["User prompt · stdin · bench task prompt"]
    PCLEAN["prompt-clean · strip filler · keep paths"]
    COMPACT["compactHistory · soft/hard thresholds"]
    FOLD["fold parallel task summaries"]
    ASSEMBLE["ContextManager.assemble · ablation gates"]
    SYS["compose system · policy + intake + optional memory extras"]
    USERIN --> PCLEAN --> COMPACT --> FOLD --> ASSEMBLE --> SYS
  end

  subgraph LOOP["⑤ Agent loop · runAgentLoop()"]
    direction TB
    RESOLVE["resolveModel · providers.ts registry"]
    STEPS["step loop · maxSteps default 12 · maxSteps:1 between tool rounds"]
    GEN["streamText / generateText · Vercel AI SDK"]
    RETRY["withProviderRetry · 429/5xx · retry-after"]
    REPAIR["tool arg repair · schema nudge once"]
    RESOLVE --> STEPS --> GEN
    GEN --> RETRY
    GEN -->|invalid args| REPAIR --> GEN
  end

  subgraph MODEL["⑥ Model response"]
    direction TB
    OUT{"Output?"}
    TEXT["assistant text / thinking deltas"]
    TOOLS["tool_calls · parallel in one step"]
    STOP["finish · stop / length / error"]
    OUT --> TEXT
    OUT --> TOOLS
    OUT --> STOP
  end

  subgraph DELEGATE["⑦ Tool dispatch"]
    direction TB
    DISPATCH{"Which tool?"}
    TASK["task subagent · explore RO · general +bash"]
    DIRECT["grep · glob · read · edit · write · bash · parallel · LSP · intake"]
    SUBLOOP["child loop ~10 steps · summary-only return"]
    DISPATCH --> TASK --> SUBLOOP
    DISPATCH --> DIRECT
  end

  subgraph SANDBOX["⑧ Sandbox gate"]
    direction TB
    MODE{"sandbox mode"}
    RUNTIME["@anthropic-ai/sandbox-runtime"]
    STUB["structured stub fallback"]
    SCRUB["env scrub · *_API_KEY removed"]
    APPROVE{"approval?"}
    DENY["deny · egress · destructive · out_of_repo"]
    EXEC["execute · cwd confined to workspace"]
    MODE -->|native ok| RUNTIME
    MODE -->|fallback| STUB
    RUNTIME --> SCRUB
    STUB --> SCRUB
    SCRUB --> APPROVE
    APPROVE -->|denied| DENY
    APPROVE -->|allowed| EXEC
  end

  subgraph LIMITS["⑨ Output shaping"]
    direction TB
    FULL["full tool result in process"]
    CAP["limits.ts · single truncation layer"]
    HINT["re-fetch hint in model message"]
    FULL --> CAP --> HINT
  end

  subgraph PERSIST["⑩ Persistence"]
    direction TB
    EV["events.jsonl append-only"]
    MEM["memory.sqlite / memory.json · tiers · supersede"]
    BENCHH["bench/history.jsonl · compare archives"]
    SESS["session.jsonl · UiBus mirror"]
  end

  subgraph UIOUT["⑪ Human surface"]
    direction TB
    TUI["Ink ADE · activity · plan · approvals · strip"]
    CHAT["clai chat · verbose stdout log"]
    HL["headless · CLAI_NO_TUI=1"]
    GLASS["clai glass · tail context_stage events"]
    DASH["bench dashboard · :4310 SSE"]
  end

  subgraph VERIFY["⑫ Completion · scaffold"]
    direction TB
    SOFT["today: soft stop on model finish"]
    TARGET["target: verify → PASS | FAIL | BLOCKED"]
    SOFT -.-> TARGET
  end

  subgraph EXT["External"]
    LLM["LLM providers · Groq · DeepSeek · …"]
    REPO["workspace files · fixtures"]
    LSPSRV["tsserver · pyright"]
    PEERS["pi · Codex · agy · compare races"]
  end

  ENTRY --> WS
  WS --> BOOT
  BOOT --> TURN
  TURN --> LOOP
  LOOP <-->|messages + tools| LLM
  LOOP --> MODEL
  MODEL -->|tool_calls| DELEGATE
  DELEGATE --> SANDBOX
  SANDBOX --> LIMITS
  LIMITS -->|tool_result| LOOP
  SUBLOOP --> LIMITS
  LOOP --> PERSIST
  LOOP --> UIOUT
  LOOP --> VERIFY
  DIRECT --> REPO
  EXEC --> REPO
  DIRECT --> LSPSRV
  ASSEMBLE --> MEM
  EV --> REPO
  MEM --> REPO
  BENCHCLI --> BENCHH
  BENCHCLI --> DASH
  BENCHCLI --> PEERS
  GLASS --> EV
  DEMO --> SANDBOX

  class ARGV,ROUTE,LAUNCH,DEMO,UTIL,BENCHCLI,HELP entry
  class PCLEAN,COMPACT,FOLD,ASSEMBLE,SYS,RESOLVE,STEPS,GEN,RETRY,REPAIR harness
  class DISPATCH,TASK,DIRECT,SUBLOOP,EXEC,CAP,HINT tool
  class EV,MEM,BENCHH,SESS persist
  class LLM,REPO,LSPSRV,PEERS external
  class UIB,TUI,CHAT,HL,GLASS,DASH ui
  class SOFT,TARGET scaffold
```

**Reading the master flow**

| Phase | What happens |
|-------|----------------|
| **① Entry** | `cli.tsx` parses argv; subcommands vs folder paths follow explicit tie-breaker rules. |
| **② Workspace** | Every artifact paths off one resolved root — no scattered `process.cwd()`. |
| **③ Bootstrap** | Heavy modules lazy-load; trace + UiBus start; intake and LSP probes run once. |
| **④ Turn prep** | Prompt clean → compaction → optional memory assemble → system prompt composition. |
| **⑤–⑥ Loop** | AI SDK step loop with provider retry, tool repair, streaming to UiBus. |
| **⑦–⑨ Tools** | Direct tools or `task` subagents; sandbox + caps before results re-enter history. |
| **⑩–⑪ Output** | JSONL trace is source of truth; three UI renderers consume the same UiBus stream. |
| **⑫ Done** | Today: model `stop`. Target: verification gate with evidence *(scaffold)*. |

---

## System overview

High-level component relationships — use the [master flow](#complete-harness-flow) for step-by-step detail.

```mermaid
flowchart TB
  subgraph humanSurface["Human surface"]
    uiTui["Ink ADE TUI"]
    uiChat["clai chat log"]
    uiHeadless["Headless printer"]
    uiDashboard["Bench dashboard SSE"]
    uiBus["UiBus event API"]
    uiTui --> uiBus
    uiChat --> uiBus
    uiHeadless --> uiBus
  end

  subgraph cliLayer["clai CLI"]
    cliEntry["cli.tsx"]
    cliWs["workspace.ts"]
    cliEntry --> cliWs
  end

  subgraph harnessPlane["Harness plane"]
    hAdapter["adapter"]
    hContext["context"]
    hMemory["memory"]
    hAgents["agents"]
    hVerify["verify scaffold"]
    hTrace["trace JSONL"]
    hAdapter --> hContext
    hContext --> hMemory
    hAdapter --> hAgents
    hAdapter --> hVerify
    hAdapter --> hTrace
  end

  subgraph toolPlane["Tool plane"]
    tTools["tools"]
    tLimits["limits.ts"]
    tLsp["LSP"]
    tIntake["intake"]
    tShell["shell jobs"]
    tSandbox["sandbox"]
    tTools --> tLimits
    tTools --> tSandbox
    tTools --> tShell
    tLsp --> tTools
    tIntake --> tTools
  end

  subgraph benchPlane["Benchmark plane"]
    bRunner["runner.ts"]
    bCompare["compare scripts"]
    bServer["server.ts SSE"]
    bStore["store history.jsonl"]
    bRunner --> bStore
    bCompare --> bStore
    bServer --> bStore
  end

  subgraph externalLayer["External"]
    extLlm["LLM providers"]
    extRepo["Workspace and fixtures"]
    extLsp["Language servers"]
  end

  cliEntry --> uiBus
  cliEntry --> hAdapter
  cliEntry --> bRunner
  hAdapter <-->|generateText and tools| extLlm
  hAdapter --> tTools
  tTools --> extRepo
  tLsp --> extLsp
  hTrace -->|events.jsonl| extRepo
  hMemory -->|.clai memory| extRepo
  bStore -->|.clai bench| extRepo
  bServer --> uiDashboard
```

| Layer | Components |
|-------|------------|
| **Human surface** | Ink TUI, `clai chat` log, headless printer, bench dashboard — all fed by `UiBus` |
| **CLI** | `cli.tsx` entry, `workspace.ts` root resolution |
| **Harness plane** | Adapter loop, context compaction/assembly, memory store, subagents, trace writer, verify scaffold |
| **Tool plane** | grep/glob/read/edit/write/bash, LSP, intake, sandbox, output limits, background shell jobs |
| **Benchmark plane** | Task runner, compare scripts (pi/Codex/all), SSE server, `history.jsonl` store |
| **External** | LLM providers, workspace files/fixtures, language servers |

---

## Two planes (core design choice)

CLAI splits **exploration** from **harness intelligence**. This is architecture, not a two-panel UI — the operator still sees one Pi/OpenCode-like terminal pane.

```mermaid
flowchart LR
  subgraph TP["Tool plane — explore like an engineer"]
    G["grep / glob / parallel"]
    R["read / edit / write"]
    B["bash · bash_bg*"]
    L["LSP"]
    I["repo_intake"]
    T["task · explore / general"]
  end

  subgraph HP["Harness plane — remember & bound context"]
    M["Memory tiers<br/>task · convention · evidence · preference"]
    C["ContextManager<br/>token budget · staleness · ablations"]
    CH["compactHistory<br/>deterministic digest"]
    V["Verification<br/>evidence · repair loop"]
    TR["Trace<br/>what happened"]
  end

  TP -->|"tool results"| HP
  HP -->|"assembled prompt extras"| Adapter["Agent loop"]
  Adapter -->|"tool calls"| TP
  T -->|"bounded summary"| Adapter
```

```mermaid
flowchart TB
  subgraph Cycle["One model step"]
    A1["Adapter sends messages + tools"] --> LLM["Provider"]
    LLM --> A2{"Tool calls?"}
    A2 -->|no| DONE["Text response · UiBus · trace"]
    A2 -->|yes| PAR["Execute in parallel"]
    PAR --> TP2["Tool plane"]
    TP2 --> CAP2["limits.ts cap"]
    CAP2 --> HP2["compactHistory if needed"]
    HP2 --> A1
  end
```

| Plane | Job | **Not** its job |
|-------|-----|-----------------|
| **Tool** | Find and change code: ripgrep, LSP, bash, read/edit | Global AST index, vector search |
| **Harness** | Durable facts, bounded prompts, proof of work, audit trail | Replace grep/LSP for discovery |

**Rule:** exploratory discovery is never “search the memory table.” Memory cites paths; tools read the live repo.

---

## Workspace model

Every session is anchored to a single resolved **workspace root** (`src/workspace.ts`). The root governs tool cwd, trace paths, memory store location, and intake scans — not scattered `process.cwd()` calls.

```mermaid
flowchart TD
  A["argv parsing<br/>parseEntry()"] --> B{"First token?"}
  B -->|reserved word| C["subcommand<br/>run · chat · demo · bench · …"]
  B -->|path| D["workspaceInput"]
  C --> E["--cwd wins over positional"]
  D --> E
  E --> F["Workspace.root<br/>absolute path"]
  F --> G[".clai/ or CLAI_DATA_DIR"]
  G --> H["traces/ · memory · bench/"]
```

| Field | Path | Role |
|-------|------|------|
| `Workspace.root` | User-supplied folder | Tool sandbox boundary, intake scan root |
| `Workspace.dataDir` | `<root>/.clai` or `CLAI_DATA_DIR` | All harness artifacts |
| `Workspace.tracesDir` | `<dataDir>/traces` | Per-run JSONL directories |
| `Workspace.isGitRepo` | `.git` present | Intake git summary; non-fatal note if absent |

**Subcommand vs path tie-breaker:** bare words `run`, `chat`, `demo`, `intake`, `memory`, `bench`, `glass`, `help` are subcommands. Anything else is a folder path. Use `clai -- demo` or `clai --cwd demo` when the folder name collides with a subcommand.

---

## CLI entry points

```mermaid
flowchart LR
  CLI["clai"] --> Q{"argv"}
  Q -->|folder path| INT["Interactive Ink session"]
  Q -->|run| RUN["Single-turn / first-turn agent"]
  Q -->|chat| CHAT["Verbose log session"]
  Q -->|demo*| DEMO["Offline · no API key"]
  Q -->|bench*| BENCH["81-task eval"]
  Q -->|glass| GLASS["Context assembly viewer"]
  Q -->|intake| IN["Repo map JSON"]
  Q -->|memory| MEM["Memory store CLI"]
  Q -->|help| HLP["Light help only"]
```

| Command | API key | Description |
|---------|---------|-------------|
| `clai` / `clai <folder>` | Yes | Interactive Ink session on the workspace root |
| `clai run "<prompt>"` | Yes | Single-turn (headless) or first-turn + interactive (TTY) |
| `clai chat ["<prompt>"]` | Yes | Verbose log-mode session — tools, I/O, tokens, cost, `ctx %` on stdout; multi-turn stdin |
| `clai demo` | No | Offline edit+bash on `fixtures/tiny-edit` |
| `clai demo lsp` | No | Offline intake + LSP diagnostics on `fixtures/lsp-ts` |
| `clai demo injection` | No | Red-team memory/context assembly demo |
| `clai glass [--run] [--follow-latest]` | No | Live glass-box view of context assembly (second terminal) |
| `clai intake` | No | Print repository intake map JSON |
| `clai memory list\|get\|set\|delete\|export` | No | Harness memory store CLI |
| `clai bench run\|serve\|list` | Optional | 81-task benchmark suite + live dashboard |

**Smart context** is always on in chat / run / TUI: prompt clean, mid-turn history compact, parallel task-result fold, overflow compact+retry. Status lines show `prompt cleaned` / `compacted context` / `folded task results`; metrics show `ctx N%`.

Heavy modules (`adapter`, `sandbox`, `bench`, `memory`) are **lazy-imported** so `clai --help` stays fast.

---

## Run lifecycle

### Interactive session (`clai` / `clai run` / `clai chat`)

```mermaid
sequenceDiagram
  autonumber
  participant U as Operator
  participant UI as UiBus / TUI / chat log
  participant A as adapter loop
  participant C as compactHistory
  participant I as repo_intake
  participant T as tools + sandbox
  participant S as task subagent
  participant LLM as Provider
  participant TR as trace JSONL

  U->>UI: clai / clai run / clai chat
  UI->>TR: run_start
  loop each user turn
    A->>I: ensureIntake (once) → summary seed
    A->>C: compactHistory if over soft/hard threshold
    C-->>A: digest or unchanged messages
    loop maxSteps (default 12)
      A->>LLM: messages + tools + system policy
      LLM-->>A: text / thinking / tool_calls
      A->>UI: assistant / thinking / tool rows / metrics
      A->>TR: model_step
      opt tool call
        alt task delegation
          A->>S: explore (RO) or general (+bash) · ~10 steps
          S-->>A: bounded summary
        else direct tool
          A->>T: grep · parallel · read · edit · bash · bash_bg · LSP
          T-->>A: capped result (+ full in trace)
        end
        A->>TR: tool_call / tool_result
      end
    end
    A->>UI: status ready / error
  end
  Note over A,V: Target: verify → PASS|FAIL|BLOCKED<br/>Today: soft stop on model finish
  A->>TR: run_end
  UI->>U: footer + trace path
```

### Context pipeline within a turn

```mermaid
flowchart LR
  P["User prompt"] --> CL["prompt-clean"]
  CL --> CH{"Over token<br/>threshold?"}
  CH -->|yes| CO["compactHistory<br/>keep task + last N turns"]
  CH -->|no| AS["assemble() · optional"]
  CO --> AS
  AS --> SY["System prompt<br/>policy + intake + memory extras"]
  SY --> AL["runAgentLoop"]
```

### Bench run path

```mermaid
flowchart TB
  BR["bench run"] --> CP["Copy fixture → temp workspace"]
  CP --> AG{"--offline?"}
  AG -->|yes| SOL["_solution/ patch"]
  AG -->|no| AGENT["runAgentLoop · toolProfile=coding"]
  SOL --> CHK["node check.mjs"]
  AGENT --> CHK
  CHK --> REC["pass / fail / timeout / error"]
  REC --> HIST["history.jsonl"]
  HIST --> SSE["Dashboard SSE · :4310"]
```

**What runs today vs designed:**

| Stage | Status | Notes |
|-------|--------|-------|
| Intake summary seed | **Wired** | First turn runs `repo_intake`; product one-liner appended to system context |
| `ContextManager.assemble()` | **Wired for glass observability** | Emits `context_stage` into the run trace each turn; prompt injection remains opt-in (`injectAssembledContext`) |
| `compactHistory()` | **Wired** | Soft trigger ≈ `min(CLAI_COMPACT_THRESHOLD_TOKENS, window×soft)`; hard ≈ window×hard; keeps original task + last N messages |
| Prompt clean | **Wired** | Strips filler from the user turn; `CLAI_PROMPT_CLEAN=0` disables |
| Multi-tool-call parallelism | **Wired** | AI SDK runs multiple tool calls in one step concurrently |
| `task` subagent | **Wired** | `explore` (read-only) or `general` (+bash); multiple `task` calls parallelize |
| Background shells | **Wired** | `bash_bg` / `bash_jobs` / `bash_output` / `bash_kill` via `ShellJobManager` |
| Provider retry | **Wired** | 429/5xx backoff with jitter; quota waits ~60s |
| Tool arg repair | **Wired** | Groq-ish schema mistakes repaired or nudged once |
| `toolProfile` | **Wired** | `"full"` (default, includes `task`) vs `"coding"` (lean set for bench fairness vs peers) |
| Verification gate | **Scaffold** | `verify/` exports empty; loop uses soft completion |

---

## Storage boundaries

No dual-write — each store owns one concern.

```mermaid
flowchart LR
  JSONL["Session JSONL<br/>`.clai/traces/<runId>/events.jsonl`<br/><i>what happened</i>"]
  SESS["Session UI log<br/>`.clai/traces/<runId>/session.jsonl`<br/><i>UiBus mirror (TUI)</i>"]
  BENCH["Bench history<br/>`.clai/bench/history.jsonl`<br/><i>eval runs</i>"]
  SQL["SQLite memory<br/>`.clai/memory.sqlite`<br/><i>what we believe now</i>"]
  ASM["Ephemeral assemble()<br/><i>one turn's prompt slice</i>"]
  COMP["Ephemeral compactHistory()<br/><i>in-process message digest</i>"]

  JSONL -.->|"provenance pointer only"| SQL
  SQL --> ASM
  ASM -->|"never persisted"| X["discarded after turn"]
  COMP -->|"never persisted"| X
```

| Store | Owns | Mutability |
|-------|------|------------|
| **JSONL trace** | Messages, tool calls, approvals, costs, full truncated tool output | Append-only |
| **session.jsonl** | UiBus mirror for TUI sessions (beside `events.jsonl`) | Append-only |
| **Bench history** | Run records, aggregates, per-task metrics | Append-only |
| **Memory DB** | Conventions, evidence, task notes | Invalidate / supersede |
| **assemble()** | Prompt context for one model turn | Ephemeral |
| **compactHistory()** | Compressed middle of message list | Ephemeral |

Working memory (current file, last grep) lives in **JSONL / in-process state**, not SQLite. Reserved tiers `episodic`, `procedure`, `working` exist in types but are not writable — they belong in session JSONL.

---

## Provider adapter

```mermaid
flowchart LR
  ENV["CLAI_PROVIDER · CLAI_MODEL · API keys"]
  REG["providers.ts registry"]
  RET["retry.ts<br/>429/5xx backoff"]
  SDK["Vercel AI SDK generateText"]
  LOOP["runAgentLoop()"]

  ENV --> REG
  REG --> SDK
  SDK --> RET
  RET --> LOOP
```

Default provider: **Groq** (`GROQ_API_KEY`). When `CLAI_PROVIDER` is unset, the first configured key wins with Groq preferred. Override with `CLAI_PROVIDER` / `CLAI_MODEL`.

| `CLAI_PROVIDER` | Env key(s) | Default model |
|-----------------|------------|---------------|
| `groq` | `GROQ_API_KEY` | `openai/gpt-oss-20b` |
| `openrouter` | `OPENROUTER_API_KEY` | `google/gemma-4-31b-it:free` |
| `cerebras` | `CEREBRAS_API_KEY` | `gemma-4-31b` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| `gemini` | `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-3.5-flash-lite` |
| `gateway` | `AI_GATEWAY_API_KEY`, `VERCEL_AI_GATEWAY_API_KEY` | `google/gemma-4-31b-it` |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-v4-flash` |

Add or remove providers in `src/adapter/providers.ts` without touching the loop. Notable provider quirks handled in-registry:

- **Gemini 3.x** — thought-signature sentinel injected for multi-step tool loops on AI SDK 4
- **OpenRouter free tier** — `data_collection: allow` injected for free endpoints
- **DeepSeek** — OpenAI-compatible base URL at `api.deepseek.com`

Retry policy (`retry.ts`): up to 4 retries on 429/5xx; quota errors wait ~60s base; respects `retry-after` headers; non-retryable errors (401, schema) fail fast as `ProviderError`.

---

## Tool plane

```mermaid
flowchart TB
  subgraph Direct["Direct tools"]
    GR["grep · glob · parallel"]
    RW["read · edit · write"]
    SH["bash · bash_bg · bash_jobs · bash_output · bash_kill"]
    LS["lsp_definition · lsp_references · lsp_diagnostics"]
    IN["repo_intake"]
  end

  subgraph Sub["Subagent · task tool"]
    EX["explore · read-only"]
    GN["general · + bash"]
    SUM["summary-only · 2 KB cap to parent"]
    EX --> SUM
    GN --> SUM
  end

  CALL["Model tool_calls · parallel"] --> Direct
  CALL --> Sub
  Direct --> SB["sandbox + workspace confinement"]
  Sub --> SB
  SB --> LM["limits.ts truncation"]
```

| Tool | Role | Notes |
|------|------|-------|
| `grep` | Ripgrep JSON → Node fallback | Parallel-safe read-only; tool default 50 matches (model-facing cap 100) |
| `glob` | fast-glob patterns | Workspace-confined; empty pattern → `**/*` |
| `read` | File I/O with offset/limit | Head+tail truncation via `limits.ts` |
| `parallel` | Batch ≤6 `grep`/`glob`/`read` | One combined result; prefer native multi-tool-call when possible |
| `edit` | Exact string replacement | Exact `oldString` → `newString` |
| `write` | Create/overwrite text files | Creates parent dirs |
| `bash` | Shell via sandbox | 60s default timeout; approval for egress/destructive/out-of-repo |
| `bash_bg` | Start background shell | Returns job id immediately; session-scoped |
| `bash_jobs` | List bg jobs | Filter `all` / `running` / `done` |
| `bash_output` | Poll bg stdout/stderr | Optional `tail` chars per stream |
| `bash_kill` | Kill bg job | Windows `taskkill` / Unix SIGTERM |
| `lsp_definition` | Go to definition | TS Language Service; Python via pyright when installed |
| `lsp_references` | Find references | Same engines as definition |
| `lsp_diagnostics` | Errors/warnings | Prefer after edits |
| `repo_intake` | Structured repo map | Languages, entrypoints, configs, test hints, summary |
| `task` | Subagent delegation | `explore` (RO) or `general` (+bash); ~10 step budget; summary-only to parent |

**Parallelism:** the Vercel AI SDK runs multiple tool calls emitted in one model step concurrently. Prefer that for independent reads/greps/`task` calls. Use `parallel({jobs:[…]})` when a single batched result is clearer.

**Background shells:** `ShellJobManager` (`src/shell/jobs.ts`) holds in-memory jobs for the session. Env scrub + destructive/egress approval apply on `bash_bg`. Subagents do not inherit `shellJobs` (bg control stays on the parent).

All paths resolve under `workspaceRoot` via `resolveInWorkspace()` — the harness cannot wander outside the fixture/repo.

### Subagents (`agents/task.ts`)

Parent loop wires `task` via `createTaskTool` (not included in the child's toolset — no recursion).

| Kind | Tools | Use |
|------|-------|-----|
| `explore` (default) | grep/glob/read/LSP/intake | Broad read-only investigation |
| `general` | explore tools + `bash` | Verify-oriented digs (tests, git, typecheck) |

Multiple `task` calls in one step run in parallel. Only a capped plain-text summary returns to the parent (`CLAI_TASK_MAX_STEPS`, default 10).

### Output caps (`tools/limits.ts`)

Tool implementations return full results (with source-level safety caps). A **single truncation layer** caps what enters the model's message history. When truncated, the full output is appended to the JSONL trace with a marker telling the model how to re-fetch (narrower grep, read with offset/limit, etc.).

| Cap | Value |
|-----|-------|
| `read` content | 8 KB (6 KB head + 2 KB tail) |
| `grep` matches | 100 (tool default request: 50) |
| `bash` stdout+stderr | 4 KB |
| `glob` paths | 200 |
| `lsp_*` items | 100 |
| `task` summary | 2 KB to parent |
| generic / other results | 16 KB serialized |

### LSP engines

| Language | Engine | External binary |
|----------|--------|-----------------|
| TypeScript / JavaScript | TypeScript Language Service | Bundled via `typescript` (no external binary) |
| Python | pyright / basedpyright | Optional; `CLAI_LSP_PY` override |
| Missing server | Structured stub (`ok: false, stub: true`) | Never hard-throws |

`probeLspAvailability()` runs at session start; available engines appear in the UI context strip.

---

## Context & memory

CLAI has **two complementary context mechanisms**:

### 1. History compaction (`context/compact.ts`) — wired in main loop

Smart, deterministic compaction (no extra model call). Thresholds come from `context/windows.ts` (per-provider window defaults; most 128k, anthropic 200k) plus env overrides:

| Trigger | Behavior |
|---------|----------|
| Soft (`min(CLAI_COMPACT_THRESHOLD_TOKENS, window×soft)`; soft default 0.7, threshold default 45k) | Digest older turns between original task and last N messages |
| Hard (~90% of window) / overflow error | Aggressive mode — keep fewer turns, tighter digests, one retry |
| Parallel `task` results | Fold long summaries in-place; digest merges findings into one "Subagent findings" block |
| Between tool rounds | Loop runs `maxSteps: 1` so compaction can run mid-turn |

Digest contents: tool outcomes (one-line), superseded reads dropped, files touched, subagent findings, recent notes. Full payloads remain in the JSONL trace.

**Prompt cleaning** (`context/prompt-clean.ts`): strips vague filler / hedges / emoji spam from the user turn while protecting fenced code and keeping every concrete ask (paths, constraints). Opt out with `CLAI_PROMPT_CLEAN=0`.

### 2. Memory assembly (`context/index.ts`) — built, demo-wired

`ContextManager.assemble()` implements the full harness memory plane:

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

Ablation env: `CLAI_MEMORY_ENABLED=0` / `CLAI_STRUCTURAL_CITATIONS=0` turn gates off (default on).

**OpenCode** records build/test/lint hints in project rules and relies on the model to run them. **CLAI** adds:

1. **Queryable memory** with `source`, `tier`, and `superseded_by` for audit.
2. **Staleness gate** — cited files re-hashed at assemble time; stale claims invalidated automatically.
3. **Real ablations** — `memoryEnabled` and `structuralCitationsEnabled` are boolean gates, not “fetch everything then zero weights.”
4. **Injection resistance** — repo text and repo-derived memory enter the prompt inside `UNTRUSTED_DATA` blocks with an explicit safety rule.

Demonstrated by `clai demo injection` against `fixtures/red-team-readme/`.

### Memory store (`memory/index.ts`)

| Tier | Writable | Default TTL |
|------|----------|-------------|
| `task` | Yes | `task` |
| `convention` | Yes | `durable` |
| `evidence` | Yes | `permanent` |
| `preference` | Yes | `permanent` |
| `episodic`, `procedure`, `working` | No (reserved) | — use JSONL |

Backends: **SQLite** (`better-sqlite3`, WAL mode) with automatic **JSON fallback** when natives are unavailable. Force JSON with `CLAI_MEMORY_BACKEND=json`.

CLI: `clai memory list|get|set|delete|export` with `--tier`, `--cite`, `--supersedes`, `--data-dir`.

---

## Sandbox

```mermaid
flowchart TD
  CMD["bash / bash_bg request"] --> MODE{"CLAI_SANDBOX_MODE · native?"}
  MODE -->|runtime| RT["sandbox-runtime wrap"]
  MODE -->|stub / missing| ST["structured stub"]
  RT --> SCRUB["env scrub"]
  ST --> SCRUB
  SCRUB --> GATE{"Approval gate"}
  GATE -->|egress · destructive · out_of_repo| ASK["UiBus approval · deny default"]
  GATE -->|ok or CLAI_AUTO_APPROVE| RUN["execute · cwd in workspace"]
  ASK -->|denied| FAIL["tool error"]
  ASK -->|approved| RUN
```

`src/sandbox/index.ts` wraps `@anthropic-ai/sandbox-runtime` with a structured stub fallback.

| Mode | When | Behavior |
|------|------|----------|
| `runtime` | Native sandbox initializes | `wrapWithSandbox()` + scrubbed env |
| `stub` | Windows ARM, missing binary, init timeout, or `CLAI_SANDBOX_MODE=stub` | Scrubbed env + approval hooks still apply |

**Approval kinds** (deny-by-default unless `CLAI_AUTO_APPROVE=1`):

- `egress` — curl, wget, npm publish, etc.
- `destructive` — rm -rf, format, dd, etc.
- `out_of_repo` — cwd outside workspace root

Env scrub removes `*_API_KEY`, `*_TOKEN`, `*_SECRET`, and similar before any shell execution. `.env` / `.env.local` are deny-write in runtime filesystem policy.

---

## Trace & glass

Append-only JSONL at `.clai/traces/<runId>/events.jsonl`.

```mermaid
flowchart LR
  RUN["Agent loop · tools · sandbox"] --> TW["TraceWriter"]
  TW --> EV["events.jsonl"]
  EV --> GL["clai glass · tail.ts"]
  EV --> AUDIT["Judge replay · provenance"]
  UIB2["UiBus"] --> SESS["session.jsonl"]
```

| Event type | Payload |
|------------|---------|
| `run_start` | cwd, timestamp |
| `run_end` | status (`ok` / `fail`), extras |
| `model_step` | provider, finishReason, toolCalls, usage |
| `assistant_text` | model prose (truncated at 4k chars in trace) |
| `tool_call` / `tool_result` | tool name, target, duration; full output when capped |
| `tool_repair` | schema repair attempts |
| `approval` | gate decisions |
| `error` | failures, recovery flags |
| `info` | compaction, provider_retry, subagent scope |
| `context_stage` | ContextManager.assemble() stage start/complete (glass pane) |

Every run gets an 8-char UUID prefix as `runId`. Bench tasks write separate traces per task under temp workspaces. Interactive TUI sessions also append a UiBus mirror at `.clai/traces/<runId>/session.jsonl`.

### Glass pane (`clai glass`)

Parallel observability surface — a **second terminal process** that tails the active (or pinned) run's `events.jsonl` and renders the Context Manager pipeline stage-by-stage. Read-only consumer of the existing append-only trace format; does not modify UiBus or the main Ink ADE.

| Flag | Behaviour |
|------|-----------|
| `--follow-latest` (default when no `--run`) | Tail the most recently modified run under `.clai/traces/`; auto-switch when a new run starts |
| `--run <runId>` | Pin to a run and replay from the start (safe demo without a live LLM call) |

```mermaid
flowchart LR
  S1["query_planner"] --> S2["structural_retrieval"]
  S2 --> S3["memory_retrieval"]
  S3 --> S4["relevance_scoring"]
  S4 --> S5["stale_check"]
  S5 --> S6["injection_scan"]
  S6 --> S7["token_budget"]
  S7 --> S8["summarizer"]
```

| Stage | Detail payload (complete) |
|-------|---------------------------|
| `query_planner` | `{ tiers, targetFragments, agentRole }` |
| `structural_retrieval` | `{ fragmentsFound, edgesExpanded }` |
| `memory_retrieval` | `{ tiersQueried, itemsFound, excludedInvalidated }` |
| `relevance_scoring` | `{ candidateCount, topScored }` |
| `stale_check` | `{ checked, staleFound, reindexed, memoryInvalidated }` |
| `injection_scan` | `{ scanned, untrustedFlagged }` |
| `token_budget` | `{ budget, included, summarized, excluded, tokensUsed }` |
| `summarizer` | `{ demoted }` |

Reusable tailer: `src/trace/tail.ts`. Ink entry: `src/ui-glass/` (reuses `src/ui/theme.ts`).

---

## UI architecture

```mermaid
flowchart TB
  Producers["adapter · tools · sandbox · verify · demo · session"]
  Bus["UiBus.emit(event)"]
  Reducer["reduceUiEvent → UiState"]
  Ink["Ink ClaiApp<br/>Header · Sidebar · Activity · Strip · Footer"]
  ChatLog["clai chat attachLogPrinter"]
  HL["headless formatHeadlessEvent"]
  SessLog["session.jsonl attachSessionLog"]

  Producers --> Bus
  Bus --> Reducer
  Reducer --> Ink
  Bus --> ChatLog
  Bus --> HL
  Bus --> SessLog
```

One event stream, three renderers — interactive TTY gets the ADE pane; `clai chat` gets a verbose log printer; CI/pipes get the same semantics as plain lines. TUI also mirrors events to `session.jsonl`.

**UiEvent types:** `user`, `assistant`, `thinking`, `tool_call`, `tool_result`, `plan`, `todo`, `approval`, `verify`, `status`, `metrics`, `context`.

Interactive session features: multi-turn prompt box, pgup/pgdn scroll, ctrl+c interrupt (marks status, does not kill in-flight provider call), context strip showing model/provider/sandbox/LSP/trace path. Thinking deltas stream when the provider surfaces reasoning.

Headless: set `CLAI_NO_TUI=1` or run on non-TTY stdout. Requires explicit prompt via `clai run "<prompt>"`.

---

## Benchmark system

Built-in Terminal-Bench-style eval loop over **81** self-contained Node.js fixtures in `fixtures/bench/`:

- **8 legacy tasks** — original CLAI mini-repo tasks (`fix-async-race`, `implement-slugify`, …)
- **73 adapted tasks** — **45** Terminal-Bench + **28** DeepSWE themes from [Terminal-Bench 2.1](https://github.com/harbor-framework/terminal-bench-2-1) and [DeepSWE](https://deepswe.datacurve.ai/), rewritten as isolated `.mjs` workspaces with `check.mjs` verifiers (no Docker required)

Full manifest: `fixtures/bench/manifest.json` (maps each task to its upstream benchmark id).

Regenerate catalog fixtures:

```bash
pnpm bench:scaffold              # write fixtures from src/bench/task-catalog/
pnpm bench:scaffold -- --force   # overwrite existing catalog tasks
pnpm bench:verify-fixtures       # broken must fail, _solution/ must pass
```

```mermaid
flowchart TB
  subgraph Eval["Eval loop"]
    R["bench run"] --> C["Copy fixture → temp dir"]
    C --> A["Agent loop or offline _solution/"]
    A --> V["node check.mjs"]
    V --> P["pass / fail / timeout / error"]
  end
  P --> H["history.jsonl"]
  H --> D["Dashboard SSE"]
  subgraph Compare["Harness compare"]
    CLAI["CLAI runner"]
    PI["pi CLI"]
    CX["Codex CLI"]
    CLAI --> RACE["sideParallel race"]
    PI --> RACE
    CX --> RACE
    RACE --> SC["compare-*.json scorecards"]
  end
```

| Command | Description |
|---------|-------------|
| `clai bench list` | List tasks from fixture `task.json` files |
| `clai bench run [--offline] [--parallel N] [--tasks id,id] [--serve]` | Run subset; default parallel 1 live / 3 offline |
| `clai bench serve [--port N]` | Live dashboard only (default port **4310**) |

**Offline mode** (`--offline`): applies `_solution/` patches instead of calling the LLM — no API key required.

Live bench agent runs use `toolProfile: "coding"` (lean toolset) for fair comparison against peer harnesses.

**Dashboard** (`bench/server.ts`): plain `node:http`, zero extra deps. Endpoints:

- `GET /` — self-contained `dashboard.html`
- `GET /events` — SSE live snapshots + compare events
- `GET /api/runs`, `GET /api/runs/:id` — history from `.clai/bench/history.jsonl`
- `GET /api/compare` — latest compare scorecard (pi / all / …)
- `GET /api/compare/:id` — archived scorecard
- `GET /api/tasks` — catalog `{ count, ids }` for the dashboard task-limit control
- `GET /api/jobs/current`, `POST /api/jobs/stop` — in-flight job control
- `POST /api/jobs` — start clai / offline / compare (`limit`, `parallel`, `tasks`, `sideParallel`, `freshClai`)

Each task: hard wall-clock timeout, configurable `maxSteps`, isolated temp workspace (fixtures never mutated), per-task trace, token/cost estimates via `pricing.ts`.

### Harness compare (`compare-*.ts`)

Same-model race against peer CLIs (default DeepSeek via provider-specific env). Dashboard **Compare** jobs call `runCompareAll` (CLAI + pi + Codex). CLI scripts:

| Script / entry | Harnesses | Needs |
|----------------|-----------|--------|
| `pnpm bench:compare-pi` | CLAI + pi | `DEEPSEEK_API_KEY` + `pi` on PATH (`PI_PROVIDER` / `PI_MODEL`) |
| `pnpm bench:compare-codex` | CLAI + Codex | Codex CLI + DeepSeek profile (`CODEX_BIN` / `CODEX_PROFILE` / `CODEX_MODEL`) |
| `pnpm bench:compare-all` | CLAI + pi + Codex | Both peers; **dashboard default** |
| `tsx src/bench/compare-agy.ts` | CLAI + `agy` | Antigravity CLI (`AGY_BIN` / `AGY_MODEL`); no package.json script |

Artifacts: `.clai/bench/compare-pi.json` (dashboard default latest), `compare-all.json`, `compare-codex.json`, `compare-agy.json`, plus `compares/<id>.json` archives.

Race hardening:

| Behavior | Detail |
|----------|--------|
| **Task limit UI** | Dashboard **10 / +10 / max** sends `limit` on job start (catalog from `/api/tasks`) |
| **Total wall time** | Scoreboard + compare cards show per-harness Σ `wallMs` (live while partial) |
| **Partial scorecards** | `compare.partial: true` while either harness is still running; task table streams live |
| **Scoreboard freeze** | Winner / composite scores stay frozen until `partial` clears (phase `"done"`) |
| **`sideParallel` split** | Fresh multi-side race splits workers per side (`COMPARE_SIDE_PARALLEL` or derived from `COMPARE_PARALLEL`) so API load is not multiplied |
| **Peer stall kill** | If pi emits no JSON stdout within `COMPARE_PI_STALL_MS` (default **15s**), the child is killed; Codex has analogous `COMPARE_CODEX_*` knobs |

While a compare job is in flight, `/api/compare` and SSE prefer the in-memory partial card so reconnects never flash a prior finished scoreboard.

See also [`CODEX-BENCH-INTEGRATION.md`](CODEX-BENCH-INTEGRATION.md) for Codex + DeepSeek wiring notes.

---

## Verification: the biggest harness delta vs OpenCode

OpenCode’s session loop ends when the model emits `stop` with no pending tool calls. Tests, lint, and build are **prompt guidance**, not runtime predicates.

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

**Today:** the adapter uses *soft completion* (“stop when the task looks done”) while `verify/index.ts` is an empty scaffold. Bench `check.mjs` scripts provide **external** verification for eval runs only.

---

## Demos & fixtures

| Fixture | Used by | Purpose |
|---------|---------|---------|
| `fixtures/tiny-edit` | `clai demo` | Minimal edit+bash loop with `check.mjs` |
| `fixtures/lsp-ts` | `clai demo lsp` | TypeScript file with intentional type error |
| `fixtures/red-team-readme` | `clai demo injection` | Prompt injection resistance demo |
| `fixtures/bench/*` | `clai bench run` | 81-task eval suite (Terminal-Bench + DeepSWE inspired) |

Offline demos emit JSON summary on headless stdout: `{ ok, runId, sandboxMode, tracePath, … }`.

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `GROQ_API_KEY` etc. | — | Provider credentials |
| `CLAI_PROVIDER` | first key found; pref groq | Provider selection |
| `CLAI_MODEL` | per-provider default | Model id override |
| `CLAI_NO_TUI` | unset | Force headless output |
| `CLAI_AUTO_APPROVE` | unset | Auto-approve sandbox gates (dev only) |
| `CLAI_SANDBOX_MODE` | unset | `stub` forces stub sandbox |
| `CLAI_DATA_DIR` | `<root>/.clai` | Override harness data directory |
| `CLAI_MEMORY_BACKEND` | sqlite with json fallback | Force `json` backend |
| `CLAI_MEMORY_ENABLED` | on | Ablation: skip memory in assemble when `0` |
| `CLAI_STRUCTURAL_CITATIONS` | on | Ablation: skip file slices when `0` |
| `CLAI_COMPACT_THRESHOLD_TOKENS` | 45000 | Soft compaction absolute ceiling (also min with window×soft) |
| `CLAI_COMPACT_KEEP_TURNS` | 10 | Verbatim trailing messages after compaction |
| `CLAI_COMPACT_SOFT_RATIO` | 0.7 | Soft compact at this fraction of model window |
| `CLAI_COMPACT_HARD_RATIO` | 0.9 | Aggressive compact / overflow pressure |
| `CLAI_CONTEXT_WINDOW` | per-model | Override assumed context window (tokens) |
| `CLAI_PROMPT_CLEAN` | on | Set `0` to disable user-prompt filler stripping |
| `CLAI_TASK_MAX_STEPS` | 10 | Subagent step budget |
| `CLAI_LSP_PY` | auto-detect | Python language-server binary |
| `CLAI_MOUSE` | on | `0` disables mouse |
| `CLAI_ASCII` | unset | `1` forces ASCII glyphs |
| `CLAI_GLYPHS` | unset | `unicode` on Windows Terminal |
| `CLAI_COLOR` | unset | color level override |
| `CLAI_NO_INTRO` | unset | `1` skips intro |
| `CLAI_INVOCATION_CWD` | — | Set by `bin/clai.js` for workspace resolution |

**Compare / peer harnesses** (bench only):

| Variable | Notes |
|----------|--------|
| `COMPARE_PARALLEL`, `COMPARE_SIDE_PARALLEL`, `COMPARE_CLAI` | Race concurrency / fresh vs history CLAI |
| `COMPARE_PI_STALL_MS` (default 15s), `COMPARE_PI_IDLE_MS`, `COMPARE_PI_STALL_BREAKER`, `COMPARE_PI_RAW`, `COMPARE_PI_DEBUG` | Pi race |
| `COMPARE_CODEX_STALL_MS`, `COMPARE_CODEX_IDLE_MS`, `COMPARE_CODEX_STALL_BREAKER`, `COMPARE_CODEX_DEBUG` | Codex race |
| `PI_PROVIDER`, `PI_MODEL`, `PI_BIN`, `PI_THINKING` | Pi defaults (deepseek / `deepseek-v4-flash`) |
| `CODEX_BIN`, `CODEX_PROFILE`, `CODEX_MODEL` | Codex defaults (`codex` / `deepseek` / `deepseek-v4-flash`) |
| `AGY_BIN`, `AGY_MODEL` | Antigravity compare |

---

## Platform notes

`better-sqlite3` and `@anthropic-ai/sandbox-runtime` are **optionalDependencies**. On Windows ARM64 (or any host without matching natives / VS C++ toolset):

- `pnpm install` still succeeds
- `pnpm clai --help`, `pnpm clai demo`, `pnpm clai bench run --offline` work
- Sandbox falls back to stub mode with `stubReason` recorded
- Memory falls back to JSON file store

Memory on SQLite needs a working native binary (x64 Node + VS Build Tools “Desktop development with C++”, or a platform with prebuilds).

Node **≥ 20** required. Package manager: **pnpm 9**.

---

## When CLAI wins

### CLAI wins on

| Area | Why |
|------|-----|
| **Eval reproducibility** | JSONL traces + ablation flags + memory provenance → judges can replay *what the harness believed* |
| **Built-in bench** | 81-task suite (TB/DeepSWE adapted), offline mode, live dashboard, pi/Codex comparison — no external harness required |
| **Honest completion** | Verification contract aims for evidence-based `PASS`, not “model stopped talking” |
| **Context discipline** | Token budget, staleness invalidation, injection labels, deterministic compaction |
| **Subagent isolation** | `task` (`explore` / `general`) keeps investigation out of parent context |
| **Simplicity** | One package, clear layers — adapter, tools, agents, memory, context, trace, bench |
| **Offline demos** | `clai demo`, `clai demo lsp`, `clai intake`, `clai bench run --offline` — no API key |
| **Platform pragmatism** | Optional deps + stub fallbacks; install succeeds even without C++ toolset |

### OpenCode wins on

| Area | Why |
|------|-----|
| **Surface area** | Terminal + desktop + IDE extensions from one backend |
| **Provider breadth** | 75+ models, Copilot/ChatGPT OAuth, Zen curated models |
| **Maturity** | Permission rulesets, sub-agents, multi-session, huge community |
| **Permission UX** | Tiered allow/ask/deny with glob patterns and doom-loop detection |

CLAI is not trying to clone OpenCode’s product surface — it studies Pi/OpenCode TUI patterns and ships an **original harness** optimized for **verification, memory, judge-grade traces, and reproducible benchmarks** on a Terminal-Bench-style loop.

---

## Quick commands

```bash
pnpm install
cp .env.example .env          # provider keys

pnpm clai --help              # light entry (lazy heavy imports)
pnpm clai                     # interactive session on cwd
pnpm clai fixtures/tiny-edit  # session on a fixture
pnpm clai chat                # verbose log-mode session
pnpm clai chat "how does the bench runner work?"
pnpm clai demo                # offline tool plane: edit + bash
pnpm clai demo lsp            # intake + LSP diagnostics
pnpm clai demo injection      # memory/context injection demo
pnpm clai intake --cwd .      # repo map JSON
pnpm clai memory list         # harness plane store
pnpm clai bench list          # 81 eval tasks
pnpm clai bench run --offline --serve   # offline run + dashboard :4310
pnpm bench:compare-pi         # CLAI vs pi scorecard (DeepSeek + pi)
pnpm bench:compare-codex      # CLAI vs Codex scorecard
pnpm bench:compare-all        # CLAI vs pi vs Codex (dashboard Compare)
CLAI_NO_TUI=1 pnpm clai run "what's in the codebase" --cwd fixtures/tiny-edit
```

Trace artifact: `.clai/traces/<runId>/events.jsonl`  
Bench history: `.clai/bench/history.jsonl`

---

## References

- User-facing docs / quick start: [`README.md`](../README.md)
- The agent itself: [`CLAI-AGENT.md`](CLAI-AGENT.md)
- Repo agent guide: [`AGENTS.md`](../AGENTS.md)
- Codex bench integration notes: [`CODEX-BENCH-INTEGRATION.md`](CODEX-BENCH-INTEGRATION.md)
- Memory & context spec: [`.scratch/wayfinder-bodies/memory-context-architecture.md`](../.scratch/wayfinder-bodies/memory-context-architecture.md)
- OpenCode peer verification note: [`.scratch/wayfinder-bodies/assets/06-peer-verify-opencode.md`](../.scratch/wayfinder-bodies/assets/06-peer-verify-opencode.md)
- Wayfinder map (ticket spine): [GitHub issue #1](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/1)
