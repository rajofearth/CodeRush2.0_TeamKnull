# CLAI — Agent Guide

Unified Agentic Coding Harness (AE-01). Single package `clai`, binary `clai`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | When |
|--------|------|
| `feat:` | New capability |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `refactor:` | Restructure without behavior change |
| `chore:` | Tooling, deps, scaffolding |

Examples: `feat: add grep tool`, `fix: handle empty memory store`, `chore: scaffold package layout`.

## Wayfinder map

Architecture and ticket spine live on GitHub:

https://github.com/rajofearth/CodeRush2.0_TeamKnull/issues/1

## Quick start

```bash
pnpm install
cp .env.example .env   # set OPENROUTER_API_KEY (default provider)
pnpm clai --help
pnpm clai demo          # offline edit+bash on fixtures/tiny-edit (no API key)
pnpm clai demo lsp      # offline intake + TS diagnostics on fixtures/lsp-ts
pnpm clai intake        # print repository intake map JSON
pnpm clai run "…"       # soft agent loop (needs a provider key)
```

## Providers (Vercel AI SDK)

Registry: `src/adapter/providers.ts`. Default **cerebras**. Add/remove providers there without touching the loop.

| Env | `CLAI_PROVIDER` |
|-----|-----------------|
| `OPENROUTER_API_KEY` | `openrouter` (default, free models) |
| `CEREBRAS_API_KEY` | `cerebras` |
| `OPENAI_API_KEY` | `openai` |
| `ANTHROPIC_API_KEY` | `anthropic` |

`CLAI_MODEL` overrides the model id (default `google/gemma-4-31b-it:free`). Never commit `.env`.

Heavy natives (`better-sqlite3`, `@anthropic-ai/sandbox-runtime`) are lazy-imported so `--help` stays light.

## Seams

| Path | Role |
|------|------|
| `src/adapter/` | Vercel AI SDK loop; pluggable providers (Cerebras default) |
| `src/tools/` | grep (rg→Node), glob, read, edit, write, bash, LSP (defs/refs/diagnostics), repo intake; parallel read-only |
| `src/sandbox/` | `@anthropic-ai/sandbox-runtime` wrap + stub fallback; env scrub; approval hooks |
| `src/memory/` | SQLite/JSON memory + CLI |
| `src/context/` | Budgeted assemble + ablation gates |
| `src/trace/` | Append-only JSONL under `.clai/traces/<runId>/events.jsonl` |
| `src/ui/` | Ink ADE shell — header, activity column, context strip, footer; `UiBus` event API + headless printer (`CLAI_NO_TUI=1` / non-TTY) |

## Platform notes

`better-sqlite3` and `@anthropic-ai/sandbox-runtime` are **optionalDependencies**. On Windows ARM64 (or any host without matching natives / VS C++ toolset), install may skip or the sandbox may fall back to a structured stub; `pnpm install` still succeeds and `pnpm clai --help` / `pnpm clai demo` work. Memory tickets need a working sqlite binary (x64 Node + VS Build Tools “Desktop development with C++”, or a platform with prebuilds).
