/**
 * tools/log-preview — human-readable previews for verbose log mode.
 * Uses the same caps as model context so logs match what the agent saw (+ markers).
 */

import type { ToolResult } from "./common.js";
import { capToolResultForModel } from "./limits.js";

/** Build a log-friendly preview of a tool result (post-cap, same as model context). */
export function previewForLog(toolName: string, result: ToolResult): unknown {
  const { result: capped, truncated } = capToolResultForModel(toolName, result);

  switch (toolName) {
    case "read": {
      const lines = capped.lines as Array<{ line: number; text: string }> | undefined;
      if (!Array.isArray(lines)) return capped;
      return {
        path: capped.path,
        truncated,
        body: lines.map((l) => `${String(l.line).padStart(5)} │ ${l.text}`).join("\n"),
      };
    }
    case "grep": {
      const matches = capped.matches as Array<{ file: string; line: number; text: string }> | undefined;
      if (!Array.isArray(matches)) return capped;
      return {
        truncated,
        notice: capped.notice,
        matches: matches.map((m) => `${m.file}:${m.line}: ${m.text}`),
      };
    }
    case "glob": {
      const files = capped.files as string[] | undefined;
      return {
        truncated,
        notice: capped.notice,
        files: files ?? [],
      };
    }
    case "bash":
      return {
        truncated,
        exitCode: capped.exitCode,
        stdout: capped.stdout,
        stderr: capped.stderr,
      };
    case "task":
      return {
        truncated: capped.truncated ?? result.truncated,
        steps: result.steps,
        summary: result.summary ?? capped.summary,
        error: result.error,
      };
    case "edit":
    case "write":
      return {
        path: capped.path,
        ok: capped.ok,
        detail: capped.error ?? capped.replacements ?? capped.bytes,
      };
    default:
      return truncated ? { ...capped, truncated: true } : capped;
  }
}
