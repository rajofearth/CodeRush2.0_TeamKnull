## Destination

A locked architecture and MVP vertical-slice build plan for CLAI (AE-01 Unified Agentic Coding Harness): all blueprint surfaces 11–18, MVP demo 19–23, eval 24–26, and deliverables 29–33 in scope at uneven depth; hard-mode 27–28 out. Ready for a short, top-model build that hits the shared evaluation contract (architecture, evidence, safety, demo, ablations).

## Notes

- **Domain:** model-independent terminal coding harness; prove harness gains under fixed model + budget.
- **Skills every session:** `/grilling`, `/domain-modeling`, Wayfinder; consult `memory-context-architecture.md` (v2) for items 12–14.
- **Stack:** TypeScript/Node, **Vercel AI SDK** (not Eve), Ink TUI, `fs`/`execa`/ripgrep tools, `better-sqlite3` memory, **`@anthropic-ai/sandbox-runtime`** (local/optional; free when local), LSP required on eval tasks.
- **UI:** OpenCode/Pi–like ADE TUI is the primary human surface (activity, tools, plan/todos, chat, status/cost, approvals). Headless/`--no-tui` is for CI/tests only.
- **Providers:** direct API keys for hackathon (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`); AI Gateway optional later.
- **Architecture:** two planes — tool plane (grep/LSP/bash/read/edit) vs harness plane (memory + budgeted context). Single Pi/OpenCode-like TUI (not two UI panels).
- **Stores:** JSONL = sessions/traces; SQLite = memory; OTel via AI SDK for cost/latency export. No dual-write of transcripts.
- **Baseline comparison:** Scored = OpenCode + Pi; Codex CLI / Cursor CLI named in writeup only for now.
- **Eval:** small Terminal-Bench (or custom) subset; report PS metrics + ablations (memory / structural citations / single vs multi / cold vs warm / baseline vs CLAI).
- **Commits:** conventional — `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- **Collaboration:** spine owned by map driver; teammates take satellite tickets (eval, fixtures, docs, baseline scripts) to avoid thrashing the core loop on a short hackathon.
- **Tracker:** GitHub sub-issues + native `blocked-by` on `rajofearth/CodeRush2.0_TeamKnull`.
- **Package:** single package `"clai"`, binary `clai`, pnpm + tsx; seams at `src/{adapter,tools,memory,context,sandbox,verify,trace,ui}/`.

## Decisions so far

- [Lock CLAI package layout and CLI binary name](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/2) — single package `clai`, pnpm+tsx, seams under `src/{adapter,tools,memory,context,sandbox,verify,trace,ui}/`; acceptance `pnpm install && pnpm clai --help`.
- [Choose Terminal-Bench scored subset and custom eval tasks](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/3) — pinned 15-task TB 2.1 coding/debug/Git slice + 2 hidden probes; asset `assets/03-terminal-bench-subset.md`.
- [Pick primary Config A baseline harness for scored comparison](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/4) — scored OpenCode + Pi; Codex CLI / Cursor CLI named in writeup only.
- [Lock minimal task-graph shape for MVP demos](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/5) — one coordinator + typed DAG with parallel read-only discovery; one verify→repair→reverify edge; graph in JSONL.
- [Define verification-first completion contract](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/6) — peer-like soft completion (OpenCode/Pi); evidence recorded; one bounded repair; TB Harbor is scored ground truth.
- [Decide trace viewer and reviewer/rollback UX](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/7) — OpenCode/Pi-like Ink TUI; JSONL + `trace.html` + export bundle for judges; no hidden CoT.
- [Write threat model and approval/sandbox policy](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/8) — sandbox-runtime; network deny after setup; approvals + kill; prompt-injection exfil demo blocked.
- [Scaffold CLAI TypeScript workspace and AGENTS.md](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/9) — `pnpm clai --help` works; seam stubs + AGENTS.md landed.
- [Implement adapter, tool plane, and sandboxed agent loop](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/10) — AI SDK soft loop + tools + sandbox stub/runtime + JSONL; `clai demo` / `clai run`.
- [Implement memory store and context assemble v2](https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/11) — SQLite/JSON memory CLI + assemble ablations + injection non-compliance demo.

## Not yet specified

- Fixture / unseen demo repository choice.
- Brand colors for Ink TUI (default: dark dense monochrome like OpenCode Zen; accent TBD).

## Out of scope

- **Vercel Eve** as CLAI core (cancelled — stay AI SDK + our seams; steal ideas only).
- Hard-mode extensions (AE-01 27–28): large monorepos, 1h+ tasks, deliberately contradictory requirements as product requirements.
- Feature parity with OpenCode / Pi / Cursor as a clone; study them, ship an original harness.
- Global AST fragment graph / embedding code search as the exploration path.
- Forking OpenCode/Pi as the submission.
