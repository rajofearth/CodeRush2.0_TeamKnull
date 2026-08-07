/**
 * limits — single home for model-facing tool-output caps.
 *
 * Tool implementations return full results (bounded only by source-level
 * safety caps); this layer truncates what enters the model's message history.
 * When truncation happens, the full result is appended to the JSONL trace and
 * the model sees a marker explaining how to get more (re-run scoped narrower).
 */

import type { ToolResult } from "./common.js";

/** All model-facing caps live here. Tune in one place. */
export const MODEL_OUTPUT_CAPS = {
  /** read: max bytes of file content shown (head + tail split). */
  readMaxBytes: 8_192,
  readHeadBytes: 6_144,
  readTailBytes: 2_048,
  /** grep: max matches shown. */
  grepMaxMatches: 100,
  /** bash: max stdout+stderr bytes shown (head + tail split). */
  bashMaxBytes: 4_096,
  bashHeadBytes: 3_072,
  bashTailBytes: 1_024,
  /** glob: max file paths listed. */
  globMaxFiles: 200,
  /** lsp_*: max locations / diagnostics listed. */
  lspMaxItems: 100,
  /** fallback: max serialized JSON bytes for any other tool result. */
  genericMaxBytes: 16_384,
  /** task subagent: max summary bytes returned to the parent context. */
  taskSummaryMaxBytes: 2_048,
} as const;

export type CapOutcome = {
  result: ToolResult;
  truncated: boolean;
};

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/**
 * Split a string into head+tail within byte budgets, marking omitted lines.
 * Returns the original string when it already fits.
 */
export function headTailClip(
  text: string,
  headBytes: number,
  tailBytes: number,
  hint: string,
): { text: string; truncated: boolean } {
  if (byteLength(text) <= headBytes + tailBytes) {
    return { text, truncated: false };
  }
  const lines = text.split("\n");
  const head: string[] = [];
  const tail: string[] = [];
  let headUsed = 0;
  let tailUsed = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    const cost = byteLength(lines[i]!) + 1;
    if (headUsed + cost > headBytes) break;
    head.push(lines[i]!);
    headUsed += cost;
  }
  let j = lines.length - 1;
  for (; j > i; j--) {
    const cost = byteLength(lines[j]!) + 1;
    if (tailUsed + cost > tailBytes) break;
    tail.unshift(lines[j]!);
    tailUsed += cost;
  }
  const omitted = Math.max(0, j - i + 1);
  const marker = `… [${omitted} lines omitted — full output in trace; ${hint}]`;
  return {
    text: [...head, marker, ...tail].join("\n"),
    truncated: true,
  };
}

type ReadLine = { line: number; text: string };

function capReadResult(result: ToolResult): CapOutcome {
  const lines = result.lines as ReadLine[] | undefined;
  if (!Array.isArray(lines)) return { result, truncated: false };
  const totalBytes = lines.reduce((n, l) => n + byteLength(l.text) + 1, 0);
  if (totalBytes <= MODEL_OUTPUT_CAPS.readMaxBytes) {
    return { result, truncated: false };
  }

  const head: ReadLine[] = [];
  const tail: ReadLine[] = [];
  let used = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    const cost = byteLength(lines[i]!.text) + 1;
    if (used + cost > MODEL_OUTPUT_CAPS.readHeadBytes) break;
    head.push(lines[i]!);
    used += cost;
  }
  used = 0;
  let j = lines.length - 1;
  for (; j > i; j--) {
    const cost = byteLength(lines[j]!.text) + 1;
    if (used + cost > MODEL_OUTPUT_CAPS.readTailBytes) break;
    tail.unshift(lines[j]!);
    used += cost;
  }
  const omitted = Math.max(0, j - i + 1);
  const firstOmitted = head.length > 0 ? head[head.length - 1]!.line + 1 : 1;
  return {
    truncated: true,
    result: {
      ...result,
      lines: [
        ...head,
        {
          line: firstOmitted,
          text: `… [${omitted} lines omitted — full output in trace; re-run read with offset/limit to see a specific range]`,
        },
        ...tail,
      ],
      truncatedForContext: true,
      omittedLines: omitted,
    },
  };
}

function capGrepResult(result: ToolResult): CapOutcome {
  const matches = result.matches as unknown[] | undefined;
  if (!Array.isArray(matches) || matches.length <= MODEL_OUTPUT_CAPS.grepMaxMatches) {
    return { result, truncated: false };
  }
  const omitted = matches.length - MODEL_OUTPUT_CAPS.grepMaxMatches;
  return {
    truncated: true,
    result: {
      ...result,
      matches: matches.slice(0, MODEL_OUTPUT_CAPS.grepMaxMatches),
      truncatedForContext: true,
      notice: `… [${omitted} matches omitted — full output in trace; narrow the pattern or scope with path]`,
    },
  };
}

function capBashResult(result: ToolResult): CapOutcome {
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (byteLength(stdout) + byteLength(stderr) <= MODEL_OUTPUT_CAPS.bashMaxBytes) {
    return { result, truncated: false };
  }
  const hint = "re-run with a narrower command (grep/head the output)";
  const out = headTailClip(
    stdout,
    MODEL_OUTPUT_CAPS.bashHeadBytes,
    MODEL_OUTPUT_CAPS.bashTailBytes,
    hint,
  );
  const err = headTailClip(
    stderr,
    Math.floor(MODEL_OUTPUT_CAPS.bashHeadBytes / 2),
    Math.floor(MODEL_OUTPUT_CAPS.bashTailBytes / 2),
    hint,
  );
  return {
    truncated: true,
    result: {
      ...result,
      stdout: out.text,
      stderr: err.text,
      truncatedForContext: true,
    },
  };
}

function capGlobResult(result: ToolResult): CapOutcome {
  const files = result.files as unknown[] | undefined;
  if (!Array.isArray(files) || files.length <= MODEL_OUTPUT_CAPS.globMaxFiles) {
    return { result, truncated: false };
  }
  const omitted = files.length - MODEL_OUTPUT_CAPS.globMaxFiles;
  return {
    truncated: true,
    result: {
      ...result,
      files: files.slice(0, MODEL_OUTPUT_CAPS.globMaxFiles),
      truncatedForContext: true,
      notice: `… [${omitted} paths omitted — full output in trace; use a more specific glob pattern]`,
    },
  };
}

function capLspResult(result: ToolResult): CapOutcome {
  for (const key of ["locations", "diagnostics"] as const) {
    const items = result[key] as unknown[] | undefined;
    if (Array.isArray(items) && items.length > MODEL_OUTPUT_CAPS.lspMaxItems) {
      const omitted = items.length - MODEL_OUTPUT_CAPS.lspMaxItems;
      return {
        truncated: true,
        result: {
          ...result,
          [key]: items.slice(0, MODEL_OUTPUT_CAPS.lspMaxItems),
          truncatedForContext: true,
          notice: `… [${omitted} ${key} omitted — full output in trace; query a narrower path]`,
        },
      };
    }
  }
  return { result, truncated: false };
}

function capGenericResult(result: ToolResult): CapOutcome {
  let serialized: string;
  try {
    serialized = JSON.stringify(result);
  } catch {
    return { result, truncated: false };
  }
  if (byteLength(serialized) <= MODEL_OUTPUT_CAPS.genericMaxBytes) {
    return { result, truncated: false };
  }
  return {
    truncated: true,
    result: {
      ok: result.ok,
      tool: result.tool,
      truncatedForContext: true,
      preview: serialized.slice(0, MODEL_OUTPUT_CAPS.genericMaxBytes),
      notice:
        "… [result too large for context — full output in trace; re-run scoped narrower]",
    },
  };
}

/**
 * Task summaries are the only child→parent payload. Prefer a structured
 * head+tail digest over a hard cut so findings at both ends survive.
 */
function capTaskResult(result: ToolResult): CapOutcome {
  const summary = typeof result.summary === "string" ? result.summary : "";
  if (!summary) {
    return { result, truncated: Boolean(result.truncated) };
  }
  if (byteLength(summary) <= MODEL_OUTPUT_CAPS.taskSummaryMaxBytes) {
    return { result, truncated: Boolean(result.truncated) };
  }
  const clipped = headTailClip(
    summary,
    Math.floor(MODEL_OUTPUT_CAPS.taskSummaryMaxBytes * 0.75),
    Math.floor(MODEL_OUTPUT_CAPS.taskSummaryMaxBytes * 0.2),
    "full subagent summary in trace",
  );
  return {
    truncated: true,
    result: {
      ...result,
      summary: clipped.text,
      truncated: true,
      truncatedForContext: true,
    },
  };
}

/**
 * The single truncation layer applied where tool results enter the message
 * history. Full outputs are the caller's responsibility to trace.
 */
export function capToolResultForModel(
  toolName: string,
  result: ToolResult,
): CapOutcome {
  let outcome: CapOutcome;
  switch (toolName) {
    case "read":
      outcome = capReadResult(result);
      break;
    case "grep":
      outcome = capGrepResult(result);
      break;
    case "bash":
      outcome = capBashResult(result);
      break;
    case "glob":
      outcome = capGlobResult(result);
      break;
    case "lsp_definition":
    case "lsp_references":
    case "lsp_diagnostics":
      outcome = capLspResult(result);
      break;
    case "task":
      outcome = capTaskResult(result);
      break;
    default:
      outcome = { result, truncated: false };
      break;
  }
  // Even tool-specific paths can still be oversized (e.g. one enormous line).
  const generic = capGenericResult(outcome.result);
  return {
    result: generic.result,
    truncated: outcome.truncated || generic.truncated,
  };
}
