# Pi peer verification memo

**Baseline identity.** The relevant peer is Mario Zechner's **Pi coding agent**, historically at [`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) (the repository now presents as `earendil-works/pi`). The package is `pi-coding-agent`; it explicitly describes itself as a “minimal terminal coding harness,” ships `read`, `write`, `edit`, and `bash`, and is the Pi commonly compared with OpenCode. This matches CLAI's existing baseline choice.

## 1. What Pi treats as “done”

Pi's default completion rule is **protocol-level, not task-level**:

- The core loop keeps asking the model for another turn while the preceding assistant message contains tool calls (or queued steering/follow-up messages remain).
- It ends normally when the model returns an assistant message with **no tool calls**. It also ends on provider `error`/`aborted`, an optional host `shouldStopAfterTurn` hook, or a tool batch whose results all request `terminate`.
- In RPC mode, `agent_end` is only the end of one low-level run; `agent_settled` is the stronger lifecycle signal meaning no automatic retry, compaction retry, or queued continuation remains.

Therefore, stock Pi does **not** independently decide that the user's acceptance criteria are satisfied. “No more tool calls” means the model chose to stop, not that the patch was proven correct.

## 2. Tests, lint, and build as gates

**No default gate exists.** Pi's default system prompt asks the model to help by reading, editing, and executing commands, but contains no universal instruction to run tests, lint, type-check, or build before finishing. The model may run project checks through `bash` when the request, repository instructions (`AGENTS.md`), a skill, or its own judgment calls for them.

The Pi repository itself documents `npm run check`, `./test.sh`, and build commands for Pi contributors, but those are project development commands—not harness-enforced completion gates. Extensions can add policy: hooks can block/modify tool calls, add tools and prompt guidance, and the agent API exposes `shouldStopAfterTurn`; stock behavior intentionally leaves such workflow decisions to customization.

## 3. Recovery and retry

- **Transient provider errors:** auto-retry is enabled by default for overload, rate-limit, and 5xx failures. Defaults are 3 retries with exponential backoff from 2 seconds (2s/4s/8s); RPC exposes retry start/end events and a toggle.
- **Context overflow:** Pi can remove the failed assistant response, compact context, and retry once. If that recovery already failed, it stops with an actionable message. Threshold compaction after a successful response does not itself retry.
- **Malformed/truncated tool calls:** if the provider stops for output length, Pi fails all tool calls from that message instead of executing possibly truncated arguments, then feeds the errors back through the loop.
- **Tool failures:** tool results carry `isError` back to the model, which may repair and try again. There is no generic harness-level retry budget for a failing test or command; semantic recovery is model-driven.
- **User intervention:** steering messages are injected after the current tool and can skip remaining calls; follow-up messages restart work after natural completion. Sessions can also resume, fork, or jump in their history.

## 4. What CLAI should copy vs avoid

**Copy**

1. Separate **run ended** from **fully settled**; expose a settled event only after retries, compaction, and queued continuations drain.
2. Keep infrastructure recovery bounded and observable: classify transient provider errors, exponential backoff, explicit attempt events, cancellation, and one-shot overflow compact/retry.
3. Never execute tool arguments truncated by a token limit.
4. Return structured tool errors to the model so it can diagnose and repair.
5. Preserve extension points for custom stop policy and verification without bloating the core loop.

**Avoid**

1. Do not equate “assistant emitted no tool call” with verified success.
2. Do not rely solely on prompting/model discretion for tests. CLAI should derive required checks from the task graph/repository contract, record each command and exit code, and gate a `verified` outcome on required checks passing.
3. Do not label provider recovery or `agent_settled` as task success. Report distinct outcomes such as `completed_unverified`, `verified`, `failed_checks`, `blocked`, and `aborted`.
4. Do not blindly retry deterministic command failures; require a changed diagnosis or patch, and cap repair cycles.

## 5. Primary sources

- Pi repository and package identity: https://github.com/badlogic/pi-mono
- Coding-agent README (minimal harness, default tools, modes, project commands): https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md
- Core loop termination and truncated-call handling: https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/agent-loop.ts
- Agent API hooks and lifecycle semantics: https://github.com/badlogic/pi-mono/blob/main/packages/agent/README.md
- Default system prompt (no mandatory verification gate): https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/system-prompt.ts
- Session retry and context-overflow recovery: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/agent-session.ts
- RPC lifecycle/retry events and retry toggle: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md
- Extension interception/customization surface: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md

_Reviewed 2026-08-07. Links to `main` describe current behavior and may move; pin the evaluated Pi version/commit in benchmark records._
