## Question

What is the verification-first completion contract (commands, success criteria, recovery from one injected failure, hidden evaluator hook) for a coding run to be allowed to “finish”?

## Constraints

- Builds/tests/linters/typechecks as ground truth — not model confidence.
- Must emit evidence memory rows + JSONL/OTel events.
- Fits fixture repos and Terminal-Bench-style tasks.
