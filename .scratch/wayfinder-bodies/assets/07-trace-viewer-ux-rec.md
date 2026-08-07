# Trace Viewer & Reviewer/Rollback UX — Recommendation

Ticket: HITL #7 (Wayfinder body `06-trace-reviewer-ux.md`) — demo 23 + deliverable 31.

## 0. Answer in one line

**Combination, but with one source of truth:** the run JSONL is the artifact; Ink shows a *live, thin* view of it; a single self-contained `trace.html` is generated from it for judges; both ship inside an export bundle keyed by `runId`. No second recording path, no dual-write.

---

## 1. Recommended medium combination (MVP hackathon)

| Layer | Medium | Why |
| --- | --- | --- |
| Source of truth | append-only `runs/<runId>/events.jsonl` | already locked in `memory-context-architecture.md` §2; replay + audit come free |
| Live operator view | Ink TUI (single Pi/OpenCode-like pane, collapsible activity/plan sections) | keeps the "one TUI" architecture constraint; no reviewer panel |
| Judge artifact | `clai trace <runId> --html` → one zero-dependency `trace.html` (inlined CSS/JS, data embedded as JSON) | judges open a file, no server, no npm install, works offline and in a submission zip |
| Handoff | `clai export <runId>` → bundle dir/zip | makes the rollback + evidence story tangible in one object |
| Replay | `clai replay <runId>` (re-renders the timeline, or re-executes with `--rerun`) | proves the run id is real, not a label |

Explicitly **not** doing for MVP: a web server / React dashboard, a second TUI panel, an OTel backend as the judge path (OTel export stays a cost/latency side channel).

Build order if time is short: JSONL schema → `trace.html` generator → export bundle → Ink polish. The HTML is the scored surface; Ink is the demo surface.

## 2. What lives where

**Ink TUI (live, ephemeral):**
- Current plan with revision marker (`plan v3 — revised after test failure`), current task node.
- Streaming assistant output + tool calls as one-line rows: tool, target, duration, ok/fail.
- Approval prompts for write/bash actions (sandbox gate).
- Running budget footer: tokens used / budget, $ cost, elapsed, `runId`.
- Compact context banner: memory items injected (count by tier), items dropped over budget, stale invalidations.
- Footer hint: `trace: clai trace <runId> --html`.
- *Not* in Ink: full diffs, full test logs, full context dumps — pointers only.

**`trace.html` (judge-facing, static, self-contained):**
- Header: runId, task, model, config flags (`memoryEnabled`, `structuralCitationsEnabled`), git base commit, totals (tokens, cost, wall time, pass/fail).
- Timeline of events, filterable by type (plan / context / tool / edit / verify / approval / error / recovery).
- Plan revisions as a diff-able list: v1 → v2 → v3, each with the *trigger event id* that caused the revision.
- Retrieved context per turn: which memory items (id, tier, source, provenance), which file citations + ranges, what was excluded and why (`over_budget`, `invalidated`, `cite_path_changed`), trust labels on untrusted repo bytes.
- Tools: command, args, exit code, truncated stdout/stderr with expand.
- Files: unified diffs per patch, linked to the commit/patch file in the bundle.
- Tests/verification: command, result, failure output, and the recovery chain (fail → replan → edit → re-verify) rendered as a visibly linked group.
- Evidence panel: verification-derived memory rows with their `run:<id>/event:<id>` provenance.
- Prompt-injection demo section: untrusted block shown labeled, plus the non-compliance event.
- Rollback header block: base commit, branch/tag, patch list, `clai rollback <runId>` command.

**Export bundle `clai export <runId>` →**
```
clai-run-<runId>/
  trace.html            # open this
  events.jsonl          # source of truth, replayable
  manifest.json         # runId, task, config, model, git base sha, totals, checksums
  patches/000N-*.patch  # ordered, git-applicable
  verify/               # test stdout/stderr per verification
  memory-snapshot.json  # memory rows read/written this run (export of SQLite subset)
  metrics.json          # tokens/cost/latency (OTel-derived)
  README.md             # 5 lines: open trace.html, replay, rollback
```

## 3. What is explicitly NOT shown

- **No hidden chain-of-thought.** Reasoning/thinking tokens from the provider are never persisted to JSONL, never rendered in Ink, never in `trace.html`. We record *reasoning token counts and cost only* (a number, for budget honesty).
- What replaces it: **structured, first-class artifacts the agent emits deliberately** — plan revisions with triggers, tool calls, context selections/exclusions, verification results. The narrative is reconstructed from actions and stated plans, not from internal monologue.
- Also excluded: raw system prompt internals beyond the labeled context blocks; API keys/env (redacted in manifest and tool env dumps); full file contents where a cited range suffices; any user secret captured in bash output (redaction pass on known key patterns before write).
- The HTML states this in a one-line banner: *"Trace shows plans, actions, and evidence. Model internal reasoning is not recorded; only its token/cost totals."* This turns a constraint into a safety talking point.

## 4. Rollback story (one paragraph)

Every run starts by pinning a base commit and doing all work on a dedicated branch/worktree (`clai/run-<runId>`), and every accepted edit is written as an ordered, git-applicable patch under `patches/` in addition to being committed — so the run's entire effect on the repo is a finite, inspectable, ordered list of diffs anchored to a known-good sha. The reviewer's decision surface is therefore binary and obvious: keep the branch (or `git apply` the patches onto their own base), or run `clai rollback <runId>`, which resets the working tree to the pinned base sha and leaves the branch, patches, and trace intact for post-mortem. Nothing is destroyed by rollback — the JSONL, the patches, and `trace.html` survive, so a rolled-back run is still full evidence — and the `trace.html` header shows base sha, patch count, and both commands verbatim, so a judge can see the undo path without reading the code.

## 5. First grilling question for the human

**Q: If a judge opens only `trace.html` and nothing else, what is the single claim it must prove — "the agent recovered from failure intelligently" or "every change is reversible and evidence-backed"? Pick one, because that choice decides what sits above the fold.**

*My recommended answer:* **"Every change is reversible and evidence-backed."** Recovery narratives are subjective and every competing harness will claim one; a verifiable audit trail (base sha → patches → test evidence → rollback command) is the differentiator that's cheap to build and impossible to hand-wave. So above the fold: run header + rollback block + verification result. Recovery lives just below, as a highlighted group inside the timeline — visible on first scroll, but not the load-bearing claim.
