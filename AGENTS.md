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
cp .env.example .env   # set GROQ_API_KEY (default provider)
pnpm clai --help
pnpm clai               # launch on the current directory as workspace root
pnpm clai chat          # verbose log session — tools, I/O, tokens, cost
pnpm clai glass         # live context-assembly glass pane (second terminal)
pnpm clai <folder>      # launch on a folder (`-- <dir>` / `--cwd <dir>` if it collides with a subcommand)
pnpm clai demo          # offline edit+bash on fixtures/tiny-edit (no API key)
pnpm clai demo lsp      # offline intake + TS diagnostics on fixtures/lsp-ts
pnpm clai intake        # print repository intake map JSON
pnpm clai bench run --offline --serve  # 81-task suite + live dashboard
pnpm bench:compare-pi                   # CLAI vs pi scorecard (needs DEEPSEEK_API_KEY + pi)
pnpm bench:compare-all                  # CLAI vs pi vs Codex (same; dashboard Compare all)
pnpm clai run "…"       # soft agent loop (needs a provider key)
```

## Providers (Vercel AI SDK)

Registry: `src/adapter/providers.ts`. Default **groq**. Add/remove providers there without touching the loop.

| Env | `CLAI_PROVIDER` |
|-----|-----------------|
| `GROQ_API_KEY` | `groq` (default) |
| `OPENROUTER_API_KEY` | `openrouter` |
| `CEREBRAS_API_KEY` | `cerebras` |
| `OPENAI_API_KEY` | `openai` |
| `ANTHROPIC_API_KEY` | `anthropic` |
| `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY`) | `gemini` |
| `AI_GATEWAY_API_KEY` (or `VERCEL_AI_GATEWAY_API_KEY`) | `gateway` (default model `google/gemma-4-31b-it`) |
| `DEEPSEEK_API_KEY` | `deepseek` (default model `deepseek-v4-flash` = DeepSeek-V4-Flash-0731) |

`CLAI_MODEL` overrides the model id (Groq default `openai/gpt-oss-20b`; Gemini default `gemini-3.5-flash-lite`). Example: `CLAI_PROVIDER=deepseek` with optional `CLAI_MODEL=deepseek-v4-flash`. Never commit `.env`.

### Smart context

Always on in chat / run / TUI: prompt clean, mid-turn history compact, parallel task-result fold, overflow compact+retry. Status lines show `prompt cleaned` / `compacted context` / `folded task results`; metrics show `ctx N%`. Tune with `CLAI_COMPACT_*`, `CLAI_CONTEXT_WINDOW`, `CLAI_PROMPT_CLEAN=0`.

Heavy natives (`better-sqlite3`, `@anthropic-ai/sandbox-runtime`) are lazy-imported so `--help` stays light.

## Seams

| Path | Role |
|------|------|
| `src/adapter/` | Vercel AI SDK loop; pluggable providers (Groq default); multi-tool-call parallelism |
| `src/tools/` | grep/glob/read/edit/write/bash, `parallel` (≤6 grep/glob/read), `bash_bg`/`bash_jobs`/`bash_output`/`bash_kill`, LSP, intake |
| `src/agents/` | `task` subagents (`explore` read-only, `general` +bash); parallel via multiple `task` calls in one step |
| `src/shell/` | Session-scoped background shell job manager (`ShellJobManager`) |
| `src/sandbox/` | `@anthropic-ai/sandbox-runtime` wrap + stub fallback; env scrub; approval hooks |
| `src/memory/` | SQLite/JSON memory + CLI |
| `src/context/` | Budgeted assemble + ablation gates |
| `src/trace/` | Append-only JSONL under `.clai/traces/<runId>/events.jsonl` |
| `src/bench/` | 81-task suite; SSE dashboard (task limit 10/+10/max); CLAI vs pi compare (partial scorecards, total wall, `sideParallel`) |
| `src/ui/` | Ink ADE shell — header, activity column, context strip, footer; `UiBus` event API + headless printer (`CLAI_NO_TUI=1` / non-TTY) |

## Platform notes

`better-sqlite3` and `@anthropic-ai/sandbox-runtime` are **optionalDependencies**. On Windows ARM64 (or any host without matching natives / VS C++ toolset), install may skip or the sandbox may fall back to a structured stub; `pnpm install` still succeeds and `pnpm clai --help` / `pnpm clai demo` work. Memory tickets need a working sqlite binary (x64 Node + VS Build Tools “Desktop development with C++”, or a platform with prebuilds).
