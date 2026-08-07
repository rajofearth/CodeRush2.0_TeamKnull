/**
 * prompt-clean — strip vague filler from the user's main prompt while
 * preserving every concrete ask (paths, constraints, errors, code).
 *
 * Deterministic, no model call. Protects fenced code / inline code from
 * rewrite. Opt out with CLAI_PROMPT_CLEAN=0.
 */

export type PromptCleanResult = {
  cleaned: string;
  changed: boolean;
  /** Short labels of what was stripped (for traces). */
  removed: string[];
};

const LEADING_FILLER =
  /^(?:(?:hey|hi|hello|yo|sup)[,!.\s]+|(?:um|uh|erm|hmm)[,!.\s]+|(?:so|anyway|basically|literally|honestly|actually)[,!.\s]+|(?:please\s+)?(?:can|could|would|will)\s+you(?:\s+please)?\s+(?:help\s+(?:me\s+)?(?:to\s+)?)?|(?:i\s+)?(?:want|need|would\s+like)\s+you\s+to\s+|please\s+(?:help\s+(?:me\s+)?(?:to\s+)?)?|just\s+|kinda\s+|kind\s+of\s+|sort\s+of\s+)+/i;

const TRAILING_FILLER =
  /(?:\s*(?:thanks|thank\s+you|thx|ty|please|lol|lmao|haha|idk|tbh|imo|i\s+guess|if\s+that\s+makes\s+sense|you\s+know)[.!?]*)+$/i;

/** Soft hedges that add no task constraint when leading a clause. */
const HEDGE_PHRASES =
  /\b(?:i\s+was\s+wondering\s+if(?:\s+you\s+could)?|if\s+possible|maybe|perhaps|not\s+sure\s+but|no\s+pressure\s+but|whenever\s+you\s+get\s+a\s+chance)\b[,:]?\s*/gi;

/** Meta fluff that misguides coding agents more than it helps. */
const META_FLUFF =
  /\b(?:be\s+creative|think\s+outside\s+the\s+box|use\s+your\s+best\s+judgment\s+creatively|make\s+it\s+awesome|go\s+wild|surprise\s+me)\b[,!.]?\s*/gi;

const EMOJI_RUN =
  /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]{2,})/gu;

type Segment = { kind: "code" | "text"; value: string };

/** Split so fenced + inline code are never rewritten. */
function segmentProtectingCode(input: string): Segment[] {
  const out: Segment[] = [];
  const re = /(```[\s\S]*?```|`[^`\n]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", value: input.slice(last, m.index) });
    }
    out.push({ kind: "code", value: m[0]! });
    last = m.index + m[0]!.length;
  }
  if (last < input.length) out.push({ kind: "text", value: input.slice(last) });
  return out.length > 0 ? out : [{ kind: "text", value: input }];
}

function cleanTextChunk(text: string, removed: string[]): string {
  let s = text.replace(/\r\n/g, "\n");

  // Collapse crazy blank lines / trailing spaces (keep paragraph breaks).
  const beforeWs = s;
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ");
  if (s !== beforeWs) removed.push("whitespace");

  const beforeEmoji = s;
  s = s.replace(EMOJI_RUN, (run) => {
    // Keep a single emoji if the run was decorative spam.
    return run.slice(0, 2);
  });
  if (s !== beforeEmoji) removed.push("emoji_spam");

  const beforeHedge = s;
  s = s.replace(HEDGE_PHRASES, "");
  if (s !== beforeHedge) removed.push("hedges");

  const beforeMeta = s;
  s = s.replace(META_FLUFF, "");
  if (s !== beforeMeta) removed.push("meta_fluff");

  // Leading / trailing politeness wrappers on the whole chunk.
  let prev = "";
  while (s !== prev) {
    prev = s;
    const lead = s.match(LEADING_FILLER);
    if (lead) {
      s = s.slice(lead[0].length);
      removed.push("leading_filler");
    }
    const trail = s.match(TRAILING_FILLER);
    if (trail && trail[0].length < s.length) {
      s = s.slice(0, s.length - trail[0].length);
      removed.push("trailing_filler");
    }
  }

  // Capitalize first letter if we stripped a leading wrapper and left lowercase.
  if (s.length > 0 && /^[a-z]/.test(s) && removed.includes("leading_filler")) {
    s = s[0]!.toUpperCase() + s.slice(1);
  }

  return s.trim();
}

/**
 * Clean a user prompt for the agent loop. Returns the original string when
 * cleaning is disabled or would empty the prompt.
 */
export function cleanUserPrompt(raw: string): PromptCleanResult {
  if (process.env.CLAI_PROMPT_CLEAN === "0") {
    return { cleaned: raw, changed: false, removed: [] };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { cleaned: raw, changed: false, removed: [] };

  const removed: string[] = [];
  const segments = segmentProtectingCode(trimmed);
  const cleanedParts = segments.map((seg) =>
    seg.kind === "code" ? seg.value : cleanTextChunk(seg.value, removed),
  );
  let cleaned = cleanedParts.join("").trim();

  // Never return empty / near-empty after cleaning — keep original.
  if (!cleaned || cleaned.length < Math.min(8, trimmed.length)) {
    return { cleaned: trimmed, changed: false, removed: [] };
  }

  // Dedupe consecutive identical paragraphs.
  const paras = cleaned.split(/\n{2,}/);
  const deduped: string[] = [];
  for (const p of paras) {
    if (deduped.length > 0 && deduped[deduped.length - 1] === p) {
      removed.push("duplicate_paragraph");
      continue;
    }
    deduped.push(p);
  }
  cleaned = deduped.join("\n\n");

  const uniq = [...new Set(removed)];
  return {
    cleaned,
    changed: cleaned !== trimmed,
    removed: uniq,
  };
}

export function promptCleanEnabled(): boolean {
  return process.env.CLAI_PROMPT_CLEAN !== "0";
}
