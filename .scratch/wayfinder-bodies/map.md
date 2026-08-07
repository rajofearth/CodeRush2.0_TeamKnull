## Destination

A locked architecture and MVP vertical-slice build plan for CLAI (AE-01 Unified Agentic Coding Harness): all blueprint surfaces 11–18, MVP demo 19–23, eval 24–26, and deliverables 29–33 in scope at uneven depth; hard-mode 27–28 out. Ready for a short, top-model build that hits the shared evaluation contract (architecture, evidence, safety, demo, ablations).

## Notes

- **Domain:** model-independent terminal coding harness; prove harness gains under fixed model + budget.
- **Skills every session:** `/grilling`, `/domain-modeling`, Wayfinder; consult `memory-context-architecture.md` (v2) for items 12–14.
- **Stack:** TypeScript/Node, Vercel AI SDK, Ink TUI, `fs`/`execa`/ripgrep tools, `better-sqlite3` memory, `@anthropic-ai/sandbox-runtime` for shell sandbox, LSP required on eval tasks.
- **Architecture:** two planes — tool plane (grep/LSP/bash/read/edit) vs harness plane (memory + budgeted context). Single Pi/OpenCode-like TUI (not two UI panels).
- **Stores:** JSONL = sessions/traces; SQLite = memory; OTel via AI SDK for cost/latency export. No dual-write of transcripts.
- **Baseline comparison:** Config A candidates = OpenCode, Pi, Codex CLI, Cursor CLI (same model where possible). Exact scored baseline deferred.
- **Eval:** small Terminal-Bench (or custom) subset; report PS metrics + ablations (memory / structural citations / single vs multi / cold vs warm / baseline vs CLAI).
- **Commits:** conventional — `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- **Collaboration:** spine owned by map driver; teammates take satellite tickets (eval, fixtures, docs, baseline scripts) to avoid thrashing the core loop on a short hackathon.
- **Tracker:** GitHub sub-issues + native `blocked-by` on `rajofearth/CodeRush2.0_TeamKnull`.

## Decisions so far

<!-- filled as tickets close -->

## Not yet specified

- Exact package/monorepo layout and CLI binary name.
- Which Terminal-Bench tasks (and count ~10–20) form the scored subset; custom hidden tasks shape.
- Which baseline harness(es) are used for the scored demo row vs informal comparison.
- Trace viewer medium (static HTML vs Ink pane vs both).
- Task-graph depth (minimal DAG vs multi-specialist) for first demo.
- AI Gateway vs direct provider keys for the hackathon.
- Fixture / unseen demo repository choice.
- Brand colors for Ink TUI.

## Out of scope

- Hard-mode extensions (AE-01 27–28): large monorepos, 1h+ tasks, deliberately contradictory requirements as product requirements.
- Feature parity with OpenCode / Pi / Cursor as a clone; study them, ship an original harness.
- Global AST fragment graph / embedding code search as the exploration path.
- Forking OpenCode/Pi as the submission.
