## Question

Implement the model-independent adapter + core tool plane (`bash` sandboxed, `grep`, `glob`, `read`, `edit`, `write`, parallel read-only) wired to Ink, producing JSONL events — the peer-shaped agent loop.

## Done when

- Same tools work behind AI SDK with a swappable model.
- Sandbox wraps shell via `@anthropic-ai/sandbox-runtime`.
- One happy-path “edit file + run command” demo works on a fixture repo.
