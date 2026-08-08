# Codex + DeepSeek bench integration research

Research note (2026-08-08): how to point local Codex CLI at the same DeepSeek model CLAI/pi use, and how to wire Codex into the CLAI bench compare harness the way `compare-pi` does.

**Local status (2026-08-08 follow-up):** npm global Codex is **0.147.0** (DeepSeek-ready). DeepSeek provider + profile (`deepseek.config.toml` / profile v2) configured; smoke `PONG` via `--profile deepseek` passed. CLI harness: `pnpm bench:compare-codex` → `src/bench/compare-codex.ts` (resolves npm `@openai/codex` before PATH). Note: PATH `codex` may still hit a stale pnpm shim at **0.139.0** — use the npm binary or let the harness resolve it. ChatGPT `auth.json` may need re-login after the DeepSeek forced-API login attempt.

---

## Verdict

1. **Same model is feasible.** Codex can call `deepseek-v4-flash` with `DEEPSEEK_API_KEY` against `https://api.deepseek.com/`, but Codex uses the **Responses API** (`wire_api = "responses"`), not Chat Completions (what CLAI uses via `@ai-sdk/openai`).
2. **Same model ≠ same agent.** Bench scores will measure **Codex harness + DeepSeek-flash** vs **CLAI loop + DeepSeek-flash** vs **pi + DeepSeek-flash**. That is the useful three-way product comparison; it is not a pure model A/B.
3. **Integration pattern already exists.** Clone `src/bench/compare-pi.ts` (full dashboard race) or start from `src/bench/compare-agy.ts` (CLI-only scorecard). Oracle stays `node check.mjs`.

---

## Part A — Point Codex at DeepSeek (same as CLAI)

### CLAI / pi baseline (repo truth)

| Piece | Value | Source |
|-------|--------|--------|
| Provider | `deepseek` | `src/adapter/providers.ts` |
| Model | `deepseek-v4-flash` (DeepSeek-V4-Flash-0731) | same + `AGENTS.md` |
| Endpoint (CLAI) | `https://api.deepseek.com` Chat Completions | `providers.ts` via `createOpenAI` |
| Key | `DEEPSEEK_API_KEY` | `.env.example` |
| Pi defaults | `PI_PROVIDER=deepseek`, `PI_MODEL=deepseek-v4-flash` | `src/bench/compare-pi.ts` |

### Codex protocol requirement

| Client | Wire API | DeepSeek path |
|--------|----------|---------------|
| CLAI | Chat Completions | `https://api.deepseek.com` + `.chat(modelId)` |
| Codex | Responses only (`wire_api = "responses"`) | `https://api.deepseek.com/` |

Official DeepSeek note: **only `deepseek-v4-flash` supports Codex today**; `deepseek-v4-pro` expected later. Do not use retired ids (`deepseek-chat`, `deepseek-reasoner`).

Primary source: [DeepSeek → Codex integration](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/).

### Step 0 — Upgrade Codex

```powershell
codex --version   # currently 0.139.0 on this device
npm install -g @openai/codex@latest
codex --version   # need ≥ 0.144.0
```

### Step 1 — Configure provider (prefer profile + env_key)

**Fast path (official installer):** launch Codex once so `%USERPROFILE%\.codex` exists, then:

```powershell
irm https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.ps1 | iex
```

Pick **deepseek-v4-flash**. The script writes `models.json` + `[model_providers.deepseek]` and may store the key as `experimental_bearer_token`.

**Bench-friendly manual config** — keep OpenAI as interactive default; add a profile so DeepSeek is opt-in:

`%USERPROFILE%\.codex\config.toml` (merge; do not wipe existing plugins):

```toml
[model_providers.deepseek]
name = "DeepSeek"
base_url = "https://api.deepseek.com/"
env_key = "DEEPSEEK_API_KEY"
wire_api = "responses"

[profiles.deepseek]
model = "deepseek-v4-flash"
model_provider = "deepseek"
preferred_auth_method = "apikey"
forced_login_method = "api"
model_reasoning_effort = "high"
model_catalog_json = "C:\\Users\\Yashraj\\.codex\\models.json"
approval_policy = "never"
sandbox_mode = "workspace-write"
```

Also install DeepSeek’s official `models.json` (installer is easiest). Prefer `env_key = "DEEPSEEK_API_KEY"` over embedding the key in TOML so CLAI, pi, and Codex share one secret.

Official field reference also documents top-level:

```toml
model = "deepseek-v4-flash"
model_provider = "deepseek"
preferred_auth_method = "apikey"
forced_login_method = "api"
model_reasoning_effort = "high"
model_catalog_json = "~/.codex/models.json"

[model_providers.deepseek]
name = "deepseek"
base_url = "https://api.deepseek.com/"
wire_api = "responses"
experimental_bearer_token = "<key>"   # prefer env_key instead
```

### Step 2 — Smoke tests

```powershell
# Independent of Codex: Responses API works with the key
curl https://api.deepseek.com/responses `
  -H "Authorization: Bearer $env:DEEPSEEK_API_KEY" `
  -H "Content-Type: application/json" `
  -d '{"model":"deepseek-v4-flash","input":"ping"}'

# Interactive: banner should show deepseek-v4-flash when profile is active
codex --profile deepseek
```

### Step 3 — Non-interactive `codex exec` (bench-shaped)

Verified on this install (`codex exec --help`): `-C/--cd`, `-m/--model`, `-p/--profile`, `-s/--sandbox`, `--skip-git-repo-check`, `--ephemeral`, `-c approval_policy=...`, `--dangerously-bypass-approvals-and-sandbox`.

Recommended spawn for fixture workdirs:

```powershell
codex exec `
  --profile deepseek `
  -m deepseek-v4-flash `
  -C "<fixture-workdir>" `
  --sandbox workspace-write `
  -c approval_policy=never `
  --skip-git-repo-check `
  --ephemeral `
  --json `
  "Fix the task. Work only inside this directory. When done, node check.mjs must exit 0."
```

| Flag | Why |
|------|-----|
| `-C` | Match pi’s `cwd = workdir` |
| `--sandbox workspace-write` | Exec default is often read-only; edits must land on disk for `check.mjs` |
| `-c approval_policy=never` | No interactive prompts |
| `--skip-git-repo-check` | Temp fixture copies are not git repos |
| `--ephemeral` | Don’t pollute `~/.codex` sessions during bench |
| `--json` | Streamable events for usage/timeouts (mirror pi `--mode json`) |

If `--json` is missing on an older build, fall back to exit code + wall time only (tokens/cost stay 0; dashboard drops those weights).

### Blockers / fairness caveats

1. **Version gate** — &lt; 0.144.0 unsupported by DeepSeek’s catalog.
2. **Harness mismatch** — Codex tools/`apply_patch` vs CLAI tools vs pi tool allowlist.
3. **Reasoning effort** — DeepSeek Codex default is `high`; CLAI/pi may differ → latency/cost skew. Pin explicitly for fair races.
4. **Partial Responses surface** — DeepSeek documents limitations vs full OpenAI Responses (no conversation store, images ignored, limited built-in tools).
5. **Secrets** — don’t commit bearer tokens; use `DEEPSEEK_API_KEY`.
6. **Provider config lives in user `~/.codex`**, not project `.codex` for `model_providers` (Codex docs: project config ignores provider defs).

Further docs: [Codex advanced config](https://developers.openai.com/codex/config-advanced), [noninteractive / exec](https://developers.openai.com/codex/noninteractive), [DeepSeek Responses guide](https://api-docs.deepseek.com/guides/responses_api).

---

## Part B — How pi is integrated today (pattern to copy)

Pi is **not** a library. It is a **subprocess harness**.

### Core files

| Path | Role |
|------|------|
| `src/bench/compare-pi.ts` | `runPi`, `runPiTask`, `runComparePi`, CLI |
| `src/bench/jobs.ts` | Job kind `"compare"` → `runComparePi` |
| `src/bench/server.ts` | `/api/compare`, jobs + `sideParallel` |
| `src/bench/store.ts` | `compare-pi.json`, `compares/`, history |
| `src/bench/dashboard.html` | Dual scorecard UI / composite weights |
| `src/bench/pricing.ts` | Shared `estimateUsdBench` |
| `src/bench/compare-agy.ts` | Lighter CLI-only third-agent precedent |
| `package.json` | `"bench:compare-pi": "tsx src/bench/compare-pi.ts"` |

### Pi invocation contract

```
pi --mode json
   --provider <PI_PROVIDER>
   --model <PI_MODEL>
   --no-session
   [--no-extensions --no-skills … --tools read,bash,edit,write]
   [--api-key <DEEPSEEK_API_KEY>]
   <prompt>
```

- **cwd:** temp copy of fixture (no `_solution` / `task.json`)
- **Prompt suffix:** `Work only inside this directory. When done, node check.mjs must exit 0.`
- **Pass/fail:** always `node check.mjs` after the agent exits (agent self-report is ignored)
- **Usage:** NDJSON `message_end` → `tokensIn` / `tokensOut` → `estimateUsdBench`
- **Concurrency:** `COMPARE_PARALLEL` split into `sideParallel` so both sides don’t double API load

### Env (pi race)

| Var | Default |
|-----|---------|
| `DEEPSEEK_API_KEY` | **required** by `runComparePi` |
| `PI_PROVIDER` / `PI_MODEL` | `deepseek` / `deepseek-v4-flash` |
| `CLAI_PROVIDER` / `CLAI_MODEL` | ambient (set `.env` to deepseek for fair race) |
| `COMPARE_SIDE_PARALLEL` | override per-side workers |

There is **no** abstract `ExternalAgent` interface — only concrete `runPi` / `runAgy`.

---

## Part C — Recommended CLAI integration plan for Codex

### Option 1 — Full parity with pi (recommended for dashboard)

1. **Upgrade Codex** ≥ 0.144.0; configure `[profiles.deepseek]` + `models.json` as above.
2. **Add** `src/bench/compare-codex.ts` mirroring `compare-pi.ts`:
   - `resolveCodexInvocation` / `CODEX_BIN` (Windows `.cmd` quirks if needed)
   - `runCodex(workdir, prompt, timeoutMs)` → `codex exec --profile deepseek -m deepseek-v4-flash -C workdir --sandbox workspace-write -c approval_policy=never --skip-git-repo-check --ephemeral --json …`
   - `runCodexTask` → fixture copy + prompt suffix + `runCheck`
   - Parse `--json` events for usage if available; else tokens=0
   - Stall/idle kill + `taskkill` on Windows (copy pi’s kill path)
3. **Wire jobs** — either `kind: "compare-codex"` or generalize `kind: "compare"` + `opponent: "pi" | "codex"`.
4. **Store / dashboard** — generalize `pi*` fields to `opponent*` (or add parallel `codex` arrays). UI currently hardcodes “pi” labels.
5. **package.json** — `"bench:compare-codex": "tsx src/bench/compare-codex.ts"`.
6. **Env** — `CODEX_BIN`, `CODEX_PROFILE=deepseek`, `CODEX_MODEL=deepseek-v4-flash`, reuse `DEEPSEEK_API_KEY`. Keep low `sideParallel` (DeepSeek stalls under load; pi already defaults conservatively).

### Option 2 — CLI-only first (like `compare-agy.ts`)

Ship a scorecard writer to `.clai/bench/compare-codex.json` without SSE/jobs. Faster to validate spawn flags and check.mjs pass rates; promote to Option 1 once stable.

### Three-way race later

Once Codex works, either:

- Run pairwise races (`clai+pi`, `clai+codex`) and join offline, or
- Generalize the runner to N harnesses with shared fixture copies and a shared oracle.

Do **not** require three concurrent DeepSeek streams at high parallelism — expect stalls/429s.

### Reuse as-is

- `loadBenchTasks` / `resolveBenchFixturesRoot`
- `runBench` (CLAI side, `toolProfile: "coding"`)
- `runCheck` / fixture copy filter from `compare-pi.ts`
- `estimateUsdBench` (DeepSeek rates already in `pricing.ts`)
- `BenchStore.appendCompare` after shape generalization

### Fairness checklist for “same model”

| Knob | Target |
|------|--------|
| Model id | `deepseek-v4-flash` on all three |
| API key | same `DEEPSEEK_API_KEY` |
| CLAI env | `CLAI_PROVIDER=deepseek` (not auto-pinned today) |
| Reasoning | pin Codex `model_reasoning_effort` intentionally |
| Tools | document asymmetry; optionally narrow CLAI/Codex for closer parity |
| Oracle | only `check.mjs` exit code |

---

## Web three-way (CLAI + pi + Codex)

Dashboard **Compare all** (`kind: "compare"`) now calls `runCompareAll` in `src/bench/compare-all.ts`:

- Races CLAI, pi, and Codex on the same fixtures with shared `check.mjs` oracle
- Streams partial scorecards over SSE (`mode: "all"`, `codex` / `codexScore` fields)
- Persists to `.clai/bench/compare-pi.json` (latest for `/api/compare`) and `compare-all.json`
- CLI: `pnpm bench:compare-all` · dual-only CLI remains `pnpm bench:compare-pi`

Requires `DEEPSEEK_API_KEY`, `pi` on PATH, and Codex ≥0.144 with `--profile deepseek` (see Part A). Keep dashboard **parallel** low (1–2) — three sides × workers hits DeepSeek hard.

---


1. Upgrade Codex → ≥ 0.144.0.
2. Run DeepSeek setup script **or** manual profile + `env_key`; smoke `codex exec --profile deepseek` on a tiny fixture.
3. Prototype `compare-codex.ts` from `compare-agy.ts` (CLI scorecard).
4. If spawn/JSON/usage look good, promote to `compare-pi`-style jobs + dashboard.
5. Document in `AGENTS.md` / `docs/ARCHITECTURE.md` next to the pi compare section.

---

## Sources

- Repo: `src/adapter/providers.ts`, `src/bench/compare-pi.ts`, `src/bench/compare-agy.ts`, `src/bench/jobs.ts`, `AGENTS.md`, `.env.example`
- Local: `codex --version` → `0.139.0`; `codex exec --help`
- [DeepSeek Codex integration](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)
- [DeepSeek Responses API](https://api-docs.deepseek.com/guides/responses_api)
- [Codex config advanced](https://developers.openai.com/codex/config-advanced)
- [Codex noninteractive](https://developers.openai.com/codex/noninteractive)
