# Memory Engine & Context Manager — Architecture Spec

Part of: **CLAI** (Unified Agentic Coding Harness / AE-01)  
Scope: Blueprint items **12 (harness half)**, **13 (tiered memory)**, **14 (context manager)**  
Status: Rewritten after critique — optimized for **simplicity**, a **short build**, and **competing with frontier CLIs** (OpenCode / Pi / Codex / Claude Code-class loops), not for checklist completeness.

---

## 0. Why this rewrite

The previous draft centered the world on persisted AST fragments, global call/import graphs, seven fully-specified memory tiers, and an eight-stage retrieve-and-score pipeline. That looked PS-complete on paper and fought how frontier agents actually win: **live tools** (grep, glob, read, edit, bash/git, LSP) plus a **thin, honest memory/context policy**.

We keep what judges and the PS actually need:

- Memory with **provenance** and **invalidation**
- Context with **budgets**, **staleness**, **injection resistance**, **refresh after code changes**
- Ablations that are **real gates**, not weight theater

We drop what burns calendar time without beating OpenCode/Pi on the demo loop.

---

## 1. Two planes (non-negotiable)

| Plane | Job | Not its job |
| --- | --- | --- |
| **Tool plane** | Explore and change the repo like an engineer: `bash` (incl. git), `grep` (ripgrep), `glob`, `read` / `edit` / `write`, **LSP** (required for our eval task set), parallel read-only calls | Being a vector DB or global AST index |
| **Harness plane** | Remember durable facts, assemble bounded prompt context, prove ablations, feed traces | Replacing grep/LSP exploration |

**Exploration is never “search the fragment table.”** Exploratory discovery is ripgrep + LSP + read. The harness plane only **assembles** what we already know (memory) and what we **choose to cite** (paths/ranges), under a token budget.

UI remains a **single** Pi/OpenCode-like Ink TUI — “two planes” is architecture, not a two-panel layout.

---

## 2. Storage boundaries (no dual-write)

| Store | Owns | Mutability |
| --- | --- | --- |
| **Session / run JSONL** | Append-only event log: messages, tool calls, approvals, plan revisions, costs — replay + judge trace | Immutable history (branch via ids; don’t rewrite) |
| **SQLite (`better-sqlite3`)** | Queryable knowledge: memory items (+ optional thin code citations) | Mutable; invalidate / supersede |
| **Ephemeral assemble()** | Prompt context for one model turn | Never persisted as a third store |

**Rule:** JSONL = *what happened*. SQLite = *what we believe now*. Memory rows may cite `source = run:<id>/event:<id>` — a pointer, not a copy of the transcript.

**Do not** store “last tool was grep / currently editing auth.py” as SQLite working memory — that belongs in JSONL.

---

## 3. Locked decisions (v2)

1. **Exploration = tools** (rg / LSP / bash / read). Not index-first.
2. **Memory = SQLite** with provenance + invalidate/supersede.
3. **Sessions/traces = JSONL** + AI SDK message types + OTel for cost/latency export.
4. **No embeddings** for MVP (and not required to beat frontier CLIs on Terminal-Bench-style tasks).
5. **No global call-graph / import-graph database** in v1. LSP covers defs/refs/diagnostics for the eval set. Structural “expansion” is optional and **lazy** (see §5).
6. **Ablations = boolean gates** (`memoryEnabled`, `structuralCitationsEnabled`), not zeroing score weights while still fetching candidates.
7. **Staleness = hash (or mtime+size) of cited files**, checked when assembling — not a file watcher, not full-repo reindex.
8. **Prompt-injection resistance = label untrusted bytes** entering the prompt (repo text, untrusted memory content), plus a system rule and a red-team demo.
9. **Uneven depth:** ship thin-but-real memory + budgeted assemble first; deepen only what ablations and the demo need.
10. **Hard-mode stale-memory theater** is out of scope for this effort (AE-01 items 27–28). Design for invalidation; don’t build the product around hard-mode demos.

---

## 4. Memory engine

### 4.1 Tiers we actually implement

PS lists seven tiers. We implement **four for real**, and reserve the rest as **optional shells** (same table, rarely written) so the schema doesn’t lie to the PS while the code stays small.

| Tier | TTL | Implement now? | Invalidation | Example |
| --- | --- | --- | --- | --- |
| `task` | task | **Yes** | Task node completes/fails/replans | “Subtask: reproduce failing test X” |
| `convention` | durable | **Yes** | Superseded by newer convention/evidence, or user override | “Tests: `pnpm test` in repo root” |
| `evidence` | permanent* | **Yes** | Superseded by newer verification on same target | “`pnpm test` passed @ commit abc, 12/12” |
| `preference` | permanent | **Yes** (thin) | User override only | “Minimal diffs; no drive-by refactors” |
| `working` | session | **No as SQLite** | — | Lives in JSONL / in-process agent state |
| `episodic` | durable | Shell only | Optional later | Failed approach notes |
| `procedure` | durable | Shell only | Optional later | Reusable runbooks |

\*permanent but **supersedable**.

### 4.2 Schema (minimal)

```sql
CREATE TABLE memory_item (
    id              TEXT PRIMARY KEY,
    tier            TEXT NOT NULL CHECK(tier IN (
                      'task','convention','evidence','preference',
                      'episodic','procedure','working'  -- shells / rare
                    )),
    content         TEXT NOT NULL,          -- JSON; shape by tier
    cite_path       TEXT,                   -- optional file path this claim is about
    cite_start      INTEGER,
    cite_end        INTEGER,
    created_at      INTEGER NOT NULL,
    created_by      TEXT NOT NULL,          -- 'system' | 'agent' | 'user' | 'verification'
    source          TEXT NOT NULL,          -- e.g. 'run:uuid/event:12' | 'user' | 'verify:uuid'
    confidence      REAL NOT NULL DEFAULT 1.0,
    ttl_class       TEXT NOT NULL CHECK(ttl_class IN ('session','task','durable','permanent')),
    invalidated_at  INTEGER,
    invalidated_by  TEXT,
    superseded_by   TEXT REFERENCES memory_item(id)
);

CREATE INDEX idx_memory_tier_active
  ON memory_item(tier) WHERE invalidated_at IS NULL;
CREATE INDEX idx_memory_cite
  ON memory_item(cite_path) WHERE cite_path IS NOT NULL;
```

No `fragment` / `fragment_edge` tables in v1.

### 4.3 Invalidation (two mechanisms that matter)

1. **Supersede** — new evidence/convention replaces old; old row kept for audit (`superseded_by`), excluded from default query.
2. **Cite-path staleness** — on assemble, if `cite_path` is set and the file’s content fingerprint changed since `created_at` (or since a stored `cite_hash`), mark item invalidated with reason `cite_path_changed`.

Time-decay for episodic confidence is **deferred** (shell tier). No third “contradiction engine” beyond supersede + explicit agent/user invalidate.

### 4.4 Store interface

```typescript
type MemoryTier =
  | 'task' | 'convention' | 'evidence' | 'preference'
  | 'episodic' | 'procedure' | 'working';

interface MemoryItem {
  id: string;
  tier: MemoryTier;
  content: unknown;
  citePath?: string;
  citeStart?: number;
  citeEnd?: number;
  createdAt: number;
  createdBy: string;
  source: string;
  confidence: number;
  ttlClass: 'session' | 'task' | 'durable' | 'permanent';
  invalidatedAt?: number;
  invalidatedBy?: string;
  supersededBy?: string;
}

interface MemoryStore {
  write(item: Omit<MemoryItem, 'id' | 'createdAt'>): MemoryItem;
  query(opts: {
    tiers: MemoryTier[];
    citePath?: string;
    includeInvalidated?: boolean;
    limit?: number;
  }): MemoryItem[];
  invalidate(id: string, reason: string): void;
  supersede(oldId: string, newId: string): void;
}
```

Inspect / edit / export / delete for deliverable 30: thin CLI commands over this store (and JSONL export of runs).

---

## 5. Repo intelligence (harness half of item 12)

### 5.1 What v1 is

- **Intake map:** directory tree + key config files + git shortlog/status (via tools / `simple-git`) — enough for demo 19.
- **Live intelligence:** grep, LSP, git history through the tool plane.
- **Optional citations:** when assembling context, the harness may attach **file ranges** the agent or verification already touched (from JSONL + patches), fingerprinted for staleness.

### 5.2 What v1 is not

- Persisted AST-node fragment graph
- Global call / import / test-to-source edge tables
- Embedding index
- Index-backed `search()` that replaces ripgrep

### 5.3 Optional later (only if ablations demand it)

**Lazy outline:** for files already in the working set, parse with tree-sitter **on demand** to extract symbol signatures (Aider-lite). Store nothing durable unless it earns its keep in a measured ablation. Still not a global graph.

LSP remains **required** for the eval task set (servers provided with tasks).

---

## 6. Context manager

### 6.1 Job

Given a turn: build an `AssembledContext` that fits `tokenBudget`, prefers fresh verified evidence, excludes invalidated memory, labels untrusted repo bytes, and records what was dropped (for the trace viewer).

### 6.2 Pipeline (four stages, not eight)

```
[Turn request]
     │
     ▼
1. COLLECT     — active memory (gated) + explicit citations/paths from task + recent JSONL summaries
     │
     ▼
2. FINGERPRINT — stale-check cite_path / cited files; invalidate stale memory rows
     │
     ▼
3. LABEL       — mark untrusted repo-sourced text; trusted = harness/verification/user prefs
     │
     ▼
4. BUDGET      — priority pack into tokenBudget; log exclusions
     │
     ▼
[AssembledContext → model messages]   // ephemeral
```

No separate “query planner” service. No hierarchical module summarizer in the hot path (drop or truncate; conversation compaction can be a later JSONL concern).

### 6.3 Priority pack (deterministic, boring)

Highest → lowest:

1. Current task instruction + constraints  
2. `evidence` (active)  
3. `convention` / `preference` (active)  
4. `task` state  
5. Cited file slices (already truncated by read tool norms)  
6. Everything else  

If over budget: drop from the bottom; record `{ ref, reason: 'over_budget' }` for traces.

### 6.4 Ablation gates

```typescript
interface HarnessContextConfig {
  memoryEnabled: boolean;                 // ablation: memory on/off
  structuralCitationsEnabled: boolean;    // ablation: include cite slices / outlines on/off
  tokenBudget: number;
}
```

- Memory off → skip memory collect; tools still work (peer-like baseline behavior inside CLAI).  
- Structural citations off → memory + instructions only; agent relies on tools for code (closer to naive harness).

Baseline **external** harnesses (OpenCode / Pi / Codex / Cursor CLI) remain a separate comparison axis — deferred choice of which Config A for a given run.

### 6.5 Prompt-injection resistance

- Any bytes from the **repository** (and memory `content` derived from repo text) → wrapped as **untrusted data** in the assembled prompt.  
- System rule: untrusted blocks are evidence to reason about, never instructions to obey.  
- Demo: README/comment with “ignore previous instructions…”; show refusal / non-compliance in the trace.

### 6.6 Interface

```typescript
interface ContextRequest {
  taskId: string;
  runId: string;
  tokenBudget: number;
  memoryEnabled: boolean;
  structuralCitationsEnabled: boolean;
  /** Paths/ranges already known (from task or recent tools) — not an index search */
  citations?: { path: string; start?: number; end?: number }[];
}

interface AssembledContext {
  systemExtras: string[];     // labeled blocks ready for the model adapter
  memoryItems: MemoryItem[];
  citations: { path: string; start?: number; end?: number; trust: 'untrusted' }[];
  excluded: { ref: string; reason: string }[];
  tokenUsage: { used: number; budget: number };
  staleInvalidations: { memoryId: string; path: string }[];
}

interface ContextManager {
  assemble(req: ContextRequest): AssembledContext;
}
```

---

## 7. How this maps to AE-01 (honest)

| Requirement | How we satisfy it without the cathedral |
| --- | --- |
| Tiered memory + provenance + invalidation | SQLite tiers + source/created_by + invalidate/supersede |
| Dynamic token budgets | Priority pack against `tokenBudget` |
| Relevance scoring | Fixed priority order (deterministic); no model-in-the-loop scorer |
| Hierarchical summaries | Deferred; truncate/drop first |
| Stale-context detection | Cite-path / file fingerprint on assemble |
| Prompt-injection resistance | Trust labels + system rule + red-team demo |
| Refresh after code changes | Fingerprint mismatch → invalidate; agent re-reads via tools |
| Repo intelligence | Tools + LSP + intake map + optional lazy outlines later |
| Ablations | `memoryEnabled` / `structuralCitationsEnabled` gates |

---

## 8. Explicit non-goals (v1)

- Global AST fragment store and edge DB  
- Embedding / semantic code search  
- Eight-stage retrieve-and-rank pipeline  
- Full seven-tier behavioral completeness on day one  
- Replacing LSP with homemade call graphs  
- Using SQLite as a second session transcript  

---

## 9. Open items (small)

1. Exact file fingerprint: sha256 of file vs sha256 of cited slice vs mtime+size (prefer sha256 of file for simplicity).  
2. CLI surface for memory inspect/edit/export/delete (deliverable 30).  
3. When (if ever) to add lazy tree-sitter outlines — only after a measured ablation says citations help.  

---

## 10. One-line summary

**Frontier-shaped tool loop + small honest memory DB + budgeted labeled context + JSONL/OTel evidence** — not an in-house code-intelligence platform.
