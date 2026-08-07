# Peer verification note: OpenCode

_Researched 2026-08-07 against OpenCode docs and the `dev` branch._

## Bottom line

OpenCode does **not** have a runtime, evidence-based definition of task completion. The core session loop is finished when the model emits a terminal finish reason (normally `stop`), there are no unresolved tool calls, and the turn has no session-level error. Tests, lint, typecheck, and build are model instructions and project conventions—not mandatory gates enforced by the harness.

## 1. What OpenCode treats as “done”

- The loop exits when the latest assistant message has a finish reason other than `tool-calls`, has no unresolved tool calls, and is newer than the user message. In other words, “done” is primarily the **model choosing to stop**, not a verifier proving acceptance criteria.
- With no configured `agent.steps`, OpenCode keeps iterating until the model stops or the user interrupts. At the step limit, it injects a prompt requiring a text summary and recommended remaining work; reaching the budget is therefore termination, not successful verification.
- Permission denial, unrecoverable processor error, user interruption, or refusal/content filtering also stop the run, but these are blocked/error outcomes rather than proof of task success.

## 2. Tests, lint, and build as gates

- They are **not hard harness gates**. OpenCode exposes Bash and relies on the model to select and run checks.
- Some bundled model prompts say to verify with the repository’s tests when feasible, and to run project-specific build/lint/typecheck commands after changes. The wording varies by model; tests are conditional (“if applicable and feasible”), while lint/typecheck are required only when the commands can be identified or were provided.
- `/init` deliberately records build, lint, test, command-order, and focused-verification guidance in `AGENTS.md`. This improves discovery and prompting, but still does not convert those commands into a runtime completion predicate.
- Evidence that this is a known gap: proposals for a verification nudge/advisory gate say core OpenCode can complete non-trivial work without verification. These are feature requests, not evidence of an existing enforced gate.

## 3. Recovery and retry behavior

- **Tool loop:** after tool calls/results, the model is invoked again. A failed tool result is preserved as an error result for the model to inspect and recover from; it is not automatically translated into a test-specific repair policy or bounded retry budget.
- **Provider retry:** retryable 429/5xx/network/overload failures use exponential backoff and honor `Retry-After`. Current `dev` source has no attempt cap in `SessionRetry.policy`; a retryable error can therefore wait/retry indefinitely. A proposed three-attempt cap exists, but the current source should be treated as authoritative.
- **Context recovery:** context overflow triggers automatic compaction unless disabled, then the session loop continues.
- **Doom-loop guard:** three consecutive identical calls to the same tool with identical input trigger the `doom_loop` permission path, allowing the user/configuration to stop or permit repetition. This detects exact repetition, not semantic lack of progress.
- **Step budget:** `agent.steps` is the general bounded-loop control. It forces a summary-only final turn; it does not establish PASS.

## 4. What CLAI should copy vs. avoid

### Copy

- Keep the unresolved-tool invariant: never accept a terminal model message while tool calls are still pending.
- Preserve structured tool failures in the next model turn so repair can use exact stdout/stderr.
- Discover repository-specific commands from executable configuration and record them in project instructions.
- Separate transient infrastructure recovery (provider backoff, context compaction) from task verification.
- Add bounded stall protection for repeated identical actions and explicit `PASS | FAIL | BLOCKED` terminal states.

### Avoid

- Do not equate the model’s `stop` finish reason with task success.
- Do not make verification merely prompt-advisory or model-specific.
- Do not treat a step/token budget expiry as successful completion.
- Do not retry provider or verification failures without both attempt and elapsed-time budgets.
- Do not use “ran a command” as evidence: require declared checks, exit status, captured evidence, and freshness against the final workspace state.

### Recommended CLAI completion contract

Before CLAI may report `PASS`, require: (1) explicit acceptance criteria; (2) a verification plan mapped to those criteria; (3) all required checks run after the final relevant edit; (4) successful exit/results with recorded evidence; and (5) no unresolved tools or uncommitted verification-side mutations. Failed checks enter a bounded diagnose → patch → rerun loop. Exhaustion, missing prerequisites, or unavailable commands terminate as `FAIL` or `BLOCKED`, never as done.

## Sources

Primary:

- OpenCode session loop (`prompt.ts`): https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt.ts
- OpenCode stream/tool processor and doom-loop detection: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts
- OpenCode provider retry policy: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/retry.ts
- Agent docs (`steps`, stop behavior, permissions): https://opencode.ai/docs/agents/
- Rules docs (`/init`, build/lint/test instructions): https://opencode.ai/docs/rules/
- Bundled Gemini prompt (verification guidance): https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt/gemini.txt
- Bundled Trinity prompt (verification guidance): https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt/trinity.txt
- `/init` prompt (discovering verification commands): https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/command/template/initialize.txt

Corroborating design/defect records:

- Verification-gate proposal documenting the current gap: https://github.com/anomalyco/opencode/issues/20873
- Verification-nudge proposal documenting skipped verification: https://github.com/anomalyco/opencode/issues/20484
- Unbounded retry defect: https://github.com/anomalyco/opencode/issues/21960
- Proposed retry cap (not reflected in current `dev` source): https://github.com/anomalyco/opencode/pull/26369
- Doom-loop detector implementation discussion: https://github.com/anomalyco/opencode/pull/3445
