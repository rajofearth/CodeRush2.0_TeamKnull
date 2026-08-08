"""Generate CLAI judging-round Q&A PDF for teammates."""

from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).with_name("CLAI-Judging-Round-QA-Prep.pdf")

TIERS = {
    "complexity": (
        "Complexity",
        "How the system is put together — seams, planes, concurrency, budgets.",
    ),
    "critical": (
        "Critical",
        "Pressure tests — honesty gaps, tradeoffs, failure modes, judge traps.",
    ),
    "depth": (
        "Depth",
        "Mechanism-level answers — numbers, defaults, why this design.",
    ),
}

# Judges only know what was in the presentation. Keep Qs presentation-facing;
# answers stay ready if they dig.
QAS = [
    {
        "tier": "complexity",
        "topic": "Identity",
        "q": "What is CLAI, in one sentence a judge can repeat?",
        "plain": (
            "CLAI is a terminal coding agent harness: one binary that wraps any "
            "LLM with live tools, memory, context budgets, traces, and a built-in "
            "bench — not a chatbot glued to a single model."
        ),
        "jargon": (
            "It is a model-agnostic agentic coding harness: an orchestration layer "
            "over the Vercel AI SDK that externalizes control (tools), persistence "
            "(tiered memory), epistemic bound (context compaction), and auditability "
            "(append-only traces)."
        ),
        "say": "We're a harness, not a model. The model is swappable; the control loop is the product.",
    },
    {
        "tier": "complexity",
        "topic": "Two planes",
        "q": "You mentioned architecture / layers — how does CLAI actually split the work?",
        "plain": (
            "Tool plane finds and changes code (grep, LSP, bash, edit). Harness plane "
            "remembers, budgets context, verifies, and records. Tools explore; the "
            "harness keeps the agent honest and replayable."
        ),
        "jargon": (
            "Separation of concerns between an operational tool plane (live repo "
            "instrumentation) and a control/harness plane (memory provenance, token "
            "budgets, verification contract, append-only telemetry). Discovery stays "
            "tool-native; durable cognition stays harness-native."
        ),
        "say": "Explore like an engineer. Remember and bound context like a harness.",
    },
    {
        "tier": "complexity",
        "topic": "Seams",
        "q": "What are the main modules, and why split them that way?",
        "plain": (
            "adapter = agent loop + providers; tools = repo actions; agents = task "
            "subagents; shell = background jobs; sandbox = isolation + approvals; "
            "memory = SQLite/JSON store; context = assemble + compact; trace = JSONL "
            "audit; bench = eval suite + dashboard; ui = terminal shell. Split so we "
            "can swap providers or harden sandbox without rewriting the loop."
        ),
        "jargon": (
            "Modular seams with narrow interfaces: the adapter is the policy loop; "
            "tools are capability endpoints; agents are bounded subordinate controllers; "
            "sandbox is a mediated execution boundary; memory/context implement a dual "
            "store; trace is an immutable event log; bench is an in-tree evaluation harness."
        ),
        "say": "Seams so we can swap providers or harden sandbox without rewriting the loop.",
    },
    {
        "tier": "complexity",
        "topic": "Parallelism",
        "q": "Does the agent do things in parallel, or is it one tool at a time?",
        "plain": (
            "Three places: (1) multiple tool calls in one model step run together, "
            "(2) a parallel tool batches up to 6 read-only jobs, (3) multiple task "
            "subagents launched in one step run together. Compare races also fan out "
            "carefully so sides don't thrash the API."
        ),
        "jargon": (
            "Intra-step tool concurrency, a bounded parallel read aggregator (≤6), "
            "and multi-agent fork-join on task calls. Evaluation uses partitioned "
            "side-parallelism to keep comparative runs load-fair under shared rate limits."
        ),
        "say": "Parallel where it's safe (reads/tasks), bounded where it's expensive (API + bash).",
    },
    {
        "tier": "complexity",
        "topic": "Subagents",
        "q": "You talked about subagents / task agents — what can they do, and what can't they?",
        "plain": (
            "explore is read-only by default; general adds bash. They summarize back "
            "to the parent in a short report. They cannot edit/write files, cannot "
            "spawn another task, and don't inherit background shell jobs — so child "
            "context stays small and capability stays limited."
        ),
        "jargon": (
            "Hierarchical delegation with capability attenuation: subordinate "
            "controllers inherit a reduced tool set, hard step budgets, and a lossy "
            "summarization channel to the parent — preventing recursive spawn and "
            "job leakage."
        ),
        "say": "Subagents explore and report; the parent decides and edits.",
    },
    {
        "tier": "complexity",
        "topic": "Smart context",
        "q": "How do you keep the model from blowing past the context window?",
        "plain": (
            "Always on in chat/run: clean the user prompt, compact mid-turn history "
            "when near the window, fold parallel task results, and if you still "
            "overflow — compact again and retry. Status shows things like 'prompt "
            "cleaned' / 'compacted context' and context %."
        ),
        "jargon": (
            "A deterministic context-management pipeline: prompt hygiene → soft/hard "
            "watermark compaction (≈70%/90% of window; soft also capped ~45k tokens) → "
            "multi-task result folding → overflow compact-and-retry. Context is a "
            "scarce resource under explicit budget policy, not an unbounded chat log."
        ),
        "say": "We don't pray the window holds — we enforce budgets mid-loop.",
    },
    {
        "tier": "critical",
        "topic": "Honesty gap",
        "q": "When you say the agent is 'done,' how do you know it actually worked?",
        "plain": (
            "Design goal: done means PASS / FAIL / BLOCKED with evidence. Today the "
            "live agent loop is still soft completion — the model stops when it thinks "
            "it's done. The bench suite's check scripts are real external verification; "
            "wiring that same verify contract fully into the live loop is still in progress."
        ),
        "jargon": (
            "Verification-contract / implementation asymmetry: the normative completion "
            "ontology exists, but the control loop still uses soft termination. Bench "
            "oracles provide exogenous verification; endogenous verify is still landing."
        ),
        "say": "We're honest: verify is designed and proven on the bench; soft-complete in the live loop today.",
    },
    {
        "tier": "critical",
        "topic": "Sandbox",
        "q": "What if isolation / sandboxing can't install on someone's machine?",
        "plain": (
            "Install still succeeds. Sandbox falls back to a structured stub; memory "
            "can fall back to JSON if SQLite natives are missing. Help, demos, and "
            "offline bench still work. Heavy natives are optional so the CLI stays usable."
        ),
        "jargon": (
            "Graceful degradation via optional native deps + stub mediation: when the "
            "sandbox runtime is unavailable, we degrade isolation fidelity rather than "
            "fail closed on install. Memory similarly degrades from SQLite to JSON."
        ),
        "say": "Shipability over brittle native coupling — degrade isolation, don't brick the CLI.",
    },
    {
        "tier": "critical",
        "topic": "Why not peers",
        "q": "Why build CLAI instead of wrapping Claude Code / Codex / OpenCode?",
        "plain": (
            "Peers optimize for product surface — many models, IDE plugins, polished UX. "
            "CLAI optimizes for judge-grade traces, memory discipline, reproducible "
            "in-tree benches, and same-model harness races. Different job to be done."
        ),
        "jargon": (
            "Different objective function: CLAI is evaluation- and audit-centric "
            "(append-only provenance, budgeted context, in-tree harness comparisons). "
            "Product agents maximize surface area; we maximize controllability, "
            "measurability, and replay."
        ),
        "say": "We're not cloning a product OS — we're building a measurable coding harness.",
    },
    {
        "tier": "critical",
        "topic": "Compare fairness",
        "q": "Your compare / race results — do those prove you have a better model?",
        "plain": (
            "No. We race CLAI vs pi vs Codex on the same DeepSeek-flash model. That "
            "measures harness quality under a fixed model — tool loop, parallelism, "
            "stalls, scoring — not 'our LLM is smarter.'"
        ),
        "jargon": (
            "Same-model, cross-harness evaluation: holding the foundation model "
            "constant isolates the orchestration substrate as the independent "
            "variable. Model quality is intentionally controlled for."
        ),
        "say": "Same model, different harness — we're scoring the control loop.",
    },
    {
        "tier": "critical",
        "topic": "Trust / injection",
        "q": "Repos can contain malicious text. How do you think about trust?",
        "plain": (
            "Repo text and tool output can be hostile. We label untrusted data vs "
            "trusted memory, scrub secrets from the process env, and gate network "
            "egress, destructive actions, and out-of-repo paths behind approvals "
            "(unless you explicitly auto-approve for demos)."
        ),
        "jargon": (
            "Dual-channel trust model: untrusted data vs trusted memory demarcation, "
            "plus mediated execution (deny-by-default approvals) and secret scrubbing "
            "at the process boundary — least-privilege / confused-deputy mitigation "
            "for agent tooling."
        ),
        "say": "Treat the repo as untrusted input; treat harness memory as cited and stale-aware.",
    },
    {
        "tier": "critical",
        "topic": "Eval size",
        "q": "How serious is your evaluation — is this a toy demo suite?",
        "plain": (
            "No. We ship an 81-task in-tree bench with isolated workspaces and "
            "oracle check scripts, plus offline mode, a live dashboard, and "
            "same-model races against peer harnesses. Started from a smaller seed "
            "set; grew into a Terminal-Bench / DeepSWE–style corpus."
        ),
        "jargon": (
            "In-tree microbenchmark corpus with exogenous oracles and multi-harness "
            "comparative runs — evaluation is a first-class product surface, not a "
            "slide-deck afterthought."
        ),
        "say": "81 tasks, offline oracle, live dashboard, peer harness races — eval is part of the product.",
    },
    {
        "tier": "critical",
        "topic": "Approvals",
        "q": "Is this safe by default when it can run shell and hit the network?",
        "plain": (
            "Default is deny until approved for egress, destructive ops, and leaving "
            "the workspace. Auto-approve exists for demos and benches — that's an "
            "explicit trust trade, not the default posture."
        ),
        "jargon": (
            "Policy-as-guardrail with human-in-the-loop mediation: deny-by-default "
            "over privileged side effects, with an explicit auto-approve escape hatch "
            "for non-interactive evaluation."
        ),
        "say": "Safe default, explicit override for headless eval.",
    },
    {
        "tier": "depth",
        "topic": "Providers",
        "q": "Are you locked to one model vendor?",
        "plain": (
            "No. Providers live in a registry. Default is Groq; you switch provider "
            "or model via env without rewriting the agent loop. Eight first-class "
            "providers today (Groq, OpenRouter, Cerebras, OpenAI, Anthropic, Gemini, "
            "Vercel AI Gateway, DeepSeek)."
        ),
        "jargon": (
            "Provider indirection via a registry atop the Vercel AI SDK — the control "
            "loop is provider-invariant; only credentials and model-id defaults are "
            "pluggable. Breadth is intentional rather than encyclopedic."
        ),
        "say": "Add a provider in the registry; don't fork the agent loop.",
    },
    {
        "tier": "depth",
        "topic": "Compaction numbers",
        "q": "Any concrete numbers for when you compact context?",
        "plain": (
            "Soft compact around min(45,000 tokens, 70% of window). Hard around 90% "
            "of window. Keep last ~10 turns by default. Most providers ~128k window; "
            "Anthropic ~200k. Tunable via env knobs."
        ),
        "jargon": (
            "Dual-watermark token budgeting: soft threshold triggers proactive history "
            "compression; hard watermark is the overflow boundary before "
            "compact-and-retry. Retention keeps a trailing window for local coherence."
        ),
        "say": "Soft at ~45k/70%, hard at 90%, keep ~10 turns.",
    },
    {
        "tier": "depth",
        "topic": "Tool caps",
        "q": "Why show the model a truncated tool output instead of everything?",
        "plain": (
            "The model sees a capped preview (e.g. read ~8KB head+tail, bash ~4KB, "
            "grep ≤100 matches). Full output still lands in the trace. Truncation "
            "protects the context budget; the audit log keeps completeness for "
            "debugging and review."
        ),
        "jargon": (
            "Asymmetric observability: lossy projection into the model context window "
            "vs near-complete persistence in the append-only event log — token economy "
            "without sacrificing forensic replay."
        ),
        "say": "Small to the model, full to the trace.",
    },
    {
        "tier": "depth",
        "topic": "Memory tiers",
        "q": "Why not just stuff everything into a bigger system prompt?",
        "plain": (
            "We use typed memory tiers (task, convention, evidence, preference) with "
            "TTLs and provenance. Session-local stuff stays session-local. You can "
            "cite, invalidate, supersede. Backend is SQLite with JSON fallback — "
            "queryable, not just chat history."
        ),
        "jargon": (
            "A typed, provenance-bearing memory ontology with TTL classes and "
            "staleness/ablation gates — separating durable institutional knowledge "
            "from ephemeral working memory, instead of undifferentiated prompt accretion."
        ),
        "say": "Memory is a store with citations and expiry — not a bigger system prompt.",
    },
    {
        "tier": "depth",
        "topic": "Traces",
        "q": "What do you mean by judge-grade / replayable traces?",
        "plain": (
            "Append-only JSONL event logs per run: start/end, model steps, tools, "
            "approvals, errors, context stages. If it can't be replayed from the log, "
            "we treat it as if it didn't happen. A glass pane can tail assembly live."
        ),
        "jargon": (
            "Immutable event sourcing for agent runs: an append-only telemetry ledger "
            "enabling post-hoc reconstruction, attribution, and evaluation. "
            "Replayability is the epistemic standard for claimed work."
        ),
        "say": "If it isn't in the JSONL, it didn't happen.",
    },
    {
        "tier": "depth",
        "topic": "Bench suite",
        "q": "Walk me through how your bench / eval actually works.",
        "plain": (
            "81 fixture workspaces with a task spec + check script oracle. Offline "
            "mode can apply a known solution and still run checks. Live mode runs "
            "the agent. Dashboard streams progress; compare scripts race peer "
            "harnesses on the same model."
        ),
        "jargon": (
            "In-tree microbenchmark corpus with exogenous oracles, isolated "
            "workspaces, and a live observation surface — plus same-model "
            "multi-harness races for relative orchestration performance under "
            "shared rate limits."
        ),
        "say": "One command: offline truth, live agent, live dashboard, peer harness races.",
    },
    {
        "tier": "depth",
        "topic": "Loop budgets",
        "q": "What stops the agent from looping forever or hanging on bash?",
        "plain": (
            "Parent step budget default 12; subagent default 10; bash timeout 60s; "
            "provider retries on flaky 429/5xx with backoff. Auth/schema errors fail "
            "fast — we don't retry a bad key."
        ),
        "jargon": (
            "Finite-horizon control with bounded retries: a step budget bounds agent "
            "depth; temporal timeouts bound tool liveliness; exponential backoff with "
            "jitter handles transient provider faults while auth/schema faults fail closed."
        ),
        "say": "12 parent steps, 10 subagent, 60s bash, retry the flaky HTTP — not the bad key.",
    },
    {
        "tier": "depth",
        "topic": "Intake / LSP",
        "q": "How does CLAI learn a codebase before editing?",
        "plain": (
            "Live tools: repo intake for a map, grep/glob/read for content, LSP for "
            "diagnostics/symbols. Memory is for durable facts you already earned — "
            "you don't search memory instead of opening files."
        ),
        "jargon": (
            "Online program comprehension via instrumented tools (structural intake + "
            "lexical search + language-server semantics), rejecting memory-as-index "
            "substitution. Memory augments; it does not replace repository ground truth."
        ),
        "say": "Read the code. Memory cites what we've already proven.",
    },
    {
        "tier": "depth",
        "topic": "UI / headless",
        "q": "Is this only a pretty terminal UI, or does it run in CI / headless too?",
        "plain": (
            "Terminal ADE shell (header, activity, context strip, footer) speaks "
            "through one event bus. Same events can drive plain headless printing "
            "when there's no TTY — one API, two renderers."
        ),
        "jargon": (
            "Presentation/control separation: a single event bus fans out to an Ink "
            "ADE view or a headless sink, so interactive and non-interactive "
            "execution share the same observability contract."
        ),
        "say": "One bus — pretty in the terminal, plain in CI.",
    },
]

SOUNDBITES = [
    "We're a harness, not a model — tools + memory + budgets + traces + bench.",
    "Two planes: explore like an engineer; bound context like a harness.",
    "81-task suite with offline oracle, live dashboard, and same-model CLAI vs pi vs Codex races.",
    "Honest gap: verify designed; soft-complete today; bench checks are real.",
    "If it isn't in the append-only JSONL, it didn't happen.",
]


class PDF(FPDF):
    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(110, 110, 110)
        self.cell(0, 6, clean("CLAI - Judging-round Q&A prep  |  team internal"), align="L")
        self.ln(8)

    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, f"{self.page_no()}", align="C")


def clean(s: str) -> str:
    return (
        s.replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2014", "-")
        .replace("\u2013", "-")
        .replace("\u2192", "->")
        .replace("\u2248", "~")
        .replace("\u2264", "<=")
        .replace("\u00b7", "-")
        .replace("\u2026", "...")
        .replace("\u00a0", " ")
    )


def h1(pdf: PDF, text: str) -> None:
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(20, 20, 20)
    pdf.multi_cell(0, 8, clean(text))
    pdf.ln(2)


def h2(pdf: PDF, text: str) -> None:
    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(20, 20, 20)
    pdf.multi_cell(0, 7, clean(text))
    pdf.ln(1)


def body(pdf: PDF, text: str, size: int = 10, color=(40, 40, 40)) -> None:
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "", size)
    pdf.set_text_color(*color)
    pdf.multi_cell(0, 5, clean(text))
    pdf.ln(1)


def label(pdf: PDF, text: str, color=(70, 70, 70)) -> None:
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*color)
    pdf.multi_cell(0, 5, clean(text))


def qa_block(pdf: PDF, n: int, qa: dict) -> None:
    if pdf.get_y() > 220:
        pdf.add_page()

    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(100, 100, 100)
    pdf.multi_cell(0, 5, clean(f"Q{n}  -  {qa['topic']}"))

    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(15, 15, 15)
    pdf.multi_cell(0, 6, clean(qa["q"]))
    pdf.ln(2)

    if pdf.get_y() > 250:
        pdf.add_page()

    pdf.set_x(pdf.l_margin)
    label(pdf, "PLAIN (say this first)", (30, 90, 140))
    pdf.set_x(pdf.l_margin)
    body(pdf, qa["plain"], 10, (35, 35, 35))

    if pdf.get_y() > 250:
        pdf.add_page()

    pdf.set_x(pdf.l_margin)
    label(pdf, "SCHOLAR JARGON (if they push)", (90, 60, 20))
    pdf.set_x(pdf.l_margin)
    body(pdf, qa["jargon"], 9, (70, 70, 70))

    if pdf.get_y() > 260:
        pdf.add_page()

    pdf.set_x(pdf.l_margin)
    label(pdf, "SOUNDBITE", (30, 110, 70))
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(25, 90, 55)
    pdf.multi_cell(0, 5, clean('"' + qa["say"] + '"'))
    pdf.ln(3)

    pdf.set_draw_color(210, 210, 210)
    y = pdf.get_y()
    pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
    pdf.ln(4)


def main() -> None:
    pdf = PDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(16, 16, 16)
    pdf.add_page()

    h1(pdf, "CLAI - Judging-round Q&A prep")
    body(
        pdf,
        "Team drill sheet. Answers are plain first, then scholar jargon if the panel presses. "
        "End every answer with the soundbite.",
        10,
        (60, 60, 60),
    )
    pdf.ln(1)

    pdf.set_fill_color(240, 248, 255)
    pdf.set_draw_color(180, 200, 220)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(30, 70, 110)
    pdf.multi_cell(
        0,
        5,
        clean(
            "Audience note: Judges only know what you said in the presentation. "
            "They will not know file paths, env vars, or internal ticket names unless you put "
            "them on a slide. Questions below are phrased like post-pitch follow-ups; "
            "answers keep the precise numbers ready if they dig."
        ),
        fill=True,
    )
    pdf.ln(3)

    body(
        pdf,
        f"{len(QAS)} prompts  |  Complexity {sum(1 for q in QAS if q['tier']=='complexity')}  /  "
        f"Critical {sum(1 for q in QAS if q['tier']=='critical')}  /  "
        f"Depth {sum(1 for q in QAS if q['tier']=='depth')}",
        9,
        (100, 100, 100),
    )

    h2(pdf, "Five soundbites to memorize")
    for i, line in enumerate(SOUNDBITES, 1):
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(20, 20, 20)
        pdf.multi_cell(0, 5, clean(f"{i}.  {line}"))
        pdf.ln(1)

    n = 0
    for tier, (title, blurb) in TIERS.items():
        pdf.add_page()
        h1(pdf, title)
        body(pdf, blurb, 10, (80, 80, 80))
        pdf.ln(1)
        for qa in QAS:
            if qa["tier"] != tier:
                continue
            n += 1
            qa_block(pdf, n, qa)

    pdf.add_page()
    h1(pdf, "How to drill (2 minutes)")
    for step in [
        "One person reads the question out loud — no peeking at answers.",
        "Speaker answers in Plain English only (30-45 seconds).",
        "If the 'judge' says 'go deeper,' escalate to Scholar jargon.",
        "Close with the Soundbite — one sentence they can write down.",
        "Mark any miss; re-run those five before the real panel.",
    ]:
        body(pdf, f"-  {step}", 10, (40, 40, 40))

    pdf.ln(4)
    h2(pdf, "Tier cheat sheet")
    body(
        pdf,
        "Complexity: seams, two planes, parallelism caps, subagent limits, smart context.",
        10,
    )
    body(
        pdf,
        "Critical: soft-verify honesty, stub sandbox, why not peers, same-model compare fairness, trust, eval seriousness, approvals.",
        10,
    )
    body(
        pdf,
        "Depth: 8 providers, 45k/70%/90% compact, tool truncation vs traces, memory TTLs, 81 tasks, step budgets 12/10, headless bus.",
        10,
    )

    pdf.output(OUT)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
