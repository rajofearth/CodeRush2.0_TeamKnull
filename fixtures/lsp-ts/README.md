# lsp-ts fixture

Minimal TypeScript repo for LSP + intake demos:

- `greeter.ts` starts with an intentional type error (`add` returns `string` but computes a number).
- `pnpm clai demo lsp` runs intake → diagnostics → edit → diagnostics again → check.
- Uses the in-process TypeScript Language Service (no external LSP binary required).
