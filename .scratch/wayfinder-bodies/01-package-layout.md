## Question

What is the exact package layout, CLI binary name, and workspace tooling (pnpm/npm, single package vs packages/*) for CLAI so a teammate can clone and run `clai` (or chosen name) in one command?

## Constraints

- TypeScript/Node, Vercel AI SDK, Ink, better-sqlite3, sandbox-runtime already locked.
- Prefer structure agents can navigate quickly; conventional commits.
- Must leave clear seams: adapter / tools / memory / context / sandbox / verify / trace.
