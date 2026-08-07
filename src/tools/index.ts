/**
 * tools — Core tool plane: grep, glob, read, edit, write, bash, LSP, intake.
 * Parallel read-only helpers included. Paths confined to workspaceRoot.
 */

import { execa } from "execa";
import fg from "fast-glob";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import {
  emitToolEvent,
  pathExists,
  resolveInWorkspace,
  type ToolContext,
  type ToolPlaneEvent,
  type ToolResult,
} from "./common.js";
import {
  lspDefinitionTool,
  lspDiagnosticsTool,
  lspReferencesTool,
} from "./lsp.js";
import { intakeTool } from "./intake.js";
import { capToolResultForModel } from "./limits.js";
import { previewForLog } from "./log-preview.js";
import { createBgShellTools } from "./bg-shell.js";

export type { ToolContext, ToolPlaneEvent, ToolResult } from "./common.js";
export { resolveInWorkspace, pathExists } from "./common.js";
export {
  lspDefinitionTool,
  lspDiagnosticsTool,
  lspReferencesTool,
  probeLspAvailability,
  disposeLspSessions,
} from "./lsp.js";
export { intakeTool, scanIntakeMap, type IntakeMap } from "./intake.js";
export { MODEL_OUTPUT_CAPS, capToolResultForModel } from "./limits.js";
export { createBgShellTools } from "./bg-shell.js";

async function emit(
  ctx: ToolContext,
  phase: "tool_call" | "tool_result",
  toolName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await emitToolEvent(ctx, phase, toolName, payload);
}

/** Prefer ripgrep (`rg`); fall back to a simple Node walk+search. */
export async function grepTool(
  ctx: ToolContext,
  args: {
    pattern: string;
    path?: string;
    glob?: string;
    caseInsensitive?: boolean;
    maxResults?: number;
  },
): Promise<ToolResult> {
  const started = Date.now();
  const searchRoot = args.path
    ? resolveInWorkspace(ctx.workspaceRoot, args.path)
    : ctx.workspaceRoot;
  await emit(ctx, "tool_call", "grep", {
    target: args.path ?? ".",
    input: args,
  });

  const maxResults = args.maxResults ?? 50;
  try {
    const rgArgs = [
      "--json",
      "--line-number",
      "-m",
      String(maxResults),
      ...(args.caseInsensitive ? ["-i"] : []),
      ...(args.glob ? ["--glob", args.glob] : []),
      args.pattern,
      searchRoot,
    ];
    const result = await execa("rg", rgArgs, {
      reject: false,
      cwd: ctx.workspaceRoot,
      timeout: 30_000,
    });

    if (result.exitCode === 0 || result.exitCode === 1) {
      const matches: Array<{ file: string; line: number; text: string }> = [];
      for (const line of (result.stdout ?? "").split("\n")) {
        // `rg -m` limits per file, not globally — enforce the global cap here.
        if (matches.length >= maxResults) break;
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as {
            type: string;
            data?: {
              path?: { text?: string };
              line_number?: number;
              lines?: { text?: string };
            };
          };
          if (row.type === "match" && row.data) {
            matches.push({
              file: path.relative(
                ctx.workspaceRoot,
                row.data.path?.text ?? "",
              ),
              line: row.data.line_number ?? 0,
              text: (row.data.lines?.text ?? "").replace(/\n$/, ""),
            });
          }
        } catch {
          /* skip non-json */
        }
      }
      const out = {
        ok: true,
        tool: "grep",
        engine: "rg",
        matches,
        count: matches.length,
        durationMs: Date.now() - started,
      };
      await emit(ctx, "tool_result", "grep", {
        target: args.path ?? ".",
        ok: true,
        durationMs: out.durationMs,
        output: previewForLog("grep", out),
      });
      return out;
    }
  } catch {
    /* fall through to node fallback */
  }

  // Node fallback
  const files = await fg(args.glob ?? "**/*", {
    cwd: searchRoot,
    absolute: true,
    onlyFiles: true,
    dot: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/.clai/**"],
  });
  const flags = args.caseInsensitive ? "i" : "";
  let re: RegExp;
  try {
    re = new RegExp(args.pattern, flags);
  } catch {
    re = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  }
  const matches: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files) {
    if (matches.length >= maxResults) break;
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxResults) break;
      if (re.test(lines[i]!)) {
        matches.push({
          file: path.relative(ctx.workspaceRoot, file),
          line: i + 1,
          text: lines[i]!,
        });
      }
    }
  }
  const out = {
    ok: true,
    tool: "grep",
    engine: "node",
    matches,
    count: matches.length,
    durationMs: Date.now() - started,
  };
  await emit(ctx, "tool_result", "grep", {
    target: args.path ?? ".",
    ok: true,
    durationMs: out.durationMs,
    output: previewForLog("grep", out),
  });
  return out;
}

export async function globTool(
  ctx: ToolContext,
  args: { pattern: string; path?: string; maxResults?: number },
): Promise<ToolResult> {
  const started = Date.now();
  // Models (esp. Groq) sometimes omit/blank the pattern — default to all files.
  const pattern = args.pattern?.trim() ? args.pattern.trim() : "**/*";
  const searchRoot = args.path
    ? resolveInWorkspace(ctx.workspaceRoot, args.path)
    : ctx.workspaceRoot;
  await emit(ctx, "tool_call", "glob", {
    target: pattern,
    input: { ...args, pattern },
  });
  try {
    const files = await fg(pattern, {
      cwd: searchRoot,
      onlyFiles: true,
      dot: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/.clai/**"],
    });
    const limited = files.slice(0, args.maxResults ?? 200);
    const out = {
      ok: true,
      tool: "glob",
      files: limited,
      count: limited.length,
      truncated: files.length > limited.length,
      pattern,
      durationMs: Date.now() - started,
    };
    await emit(ctx, "tool_result", "glob", {
      target: pattern,
      ok: true,
      durationMs: out.durationMs,
      output: previewForLog("glob", out),
    });
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const out = {
      ok: false,
      tool: "glob",
      error: message,
      pattern,
      durationMs: Date.now() - started,
    };
    await emit(ctx, "tool_result", "glob", {
      target: pattern,
      ok: false,
      durationMs: out.durationMs,
      detail: message,
    });
    return out;
  }
}

export async function readTool(
  ctx: ToolContext,
  args: { path: string; offset?: number; limit?: number },
): Promise<ToolResult> {
  const started = Date.now();
  const abs = resolveInWorkspace(ctx.workspaceRoot, args.path);
  await emit(ctx, "tool_call", "read", { target: args.path, input: args });
  try {
    const content = await readFile(abs, "utf8");
    const lines = content.split(/\r?\n/);
    const offset = Math.max(1, args.offset ?? 1);
    const limit = args.limit ?? lines.length;
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const out = {
      ok: true,
      tool: "read",
      path: path.relative(ctx.workspaceRoot, abs),
      offset,
      lines: slice.map((text, i) => ({ line: offset + i, text })),
      totalLines: lines.length,
      durationMs: Date.now() - started,
    };
    await emit(ctx, "tool_result", "read", {
      target: args.path,
      ok: true,
      durationMs: out.durationMs,
      output: previewForLog("read", out),
    });
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const out = {
      ok: false,
      tool: "read",
      path: args.path,
      error: message,
      durationMs: Date.now() - started,
    };
    await emit(ctx, "tool_result", "read", {
      target: args.path,
      ok: false,
      durationMs: out.durationMs,
      detail: message.slice(0, 200),
    });
    return out;
  }
}

export async function editTool(
  ctx: ToolContext,
  args: { path: string; oldString: string; newString: string; replaceAll?: boolean },
): Promise<ToolResult> {
  const started = Date.now();
  const abs = resolveInWorkspace(ctx.workspaceRoot, args.path);
  await emit(ctx, "tool_call", "edit", { target: args.path, input: { path: args.path } });
  const before = await readFile(abs, "utf8");
  if (!before.includes(args.oldString)) {
    const out = {
      ok: false,
      tool: "edit",
      path: args.path,
      error: "oldString not found",
      durationMs: Date.now() - started,
    };
    await emit(ctx, "tool_result", "edit", {
      target: args.path,
      ok: false,
      durationMs: out.durationMs,
      detail: "oldString not found",
    });
    return out;
  }
  const after = args.replaceAll
    ? before.split(args.oldString).join(args.newString)
    : before.replace(args.oldString, args.newString);
  await writeFile(abs, after, "utf8");
  const out = {
    ok: true,
    tool: "edit",
    path: path.relative(ctx.workspaceRoot, abs),
    replacements: args.replaceAll
      ? before.split(args.oldString).length - 1
      : 1,
    durationMs: Date.now() - started,
  };
  await emit(ctx, "tool_result", "edit", {
    target: args.path,
    ok: true,
    durationMs: out.durationMs,
    output: previewForLog("edit", out),
  });
  return out;
}

export async function writeTool(
  ctx: ToolContext,
  args: { path: string; content: string },
): Promise<ToolResult> {
  const started = Date.now();
  const abs = resolveInWorkspace(ctx.workspaceRoot, args.path);
  await emit(ctx, "tool_call", "write", { target: args.path, input: { path: args.path } });
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, args.content, "utf8");
  const out = {
    ok: true,
    tool: "write",
    path: path.relative(ctx.workspaceRoot, abs),
    bytes: Buffer.byteLength(args.content, "utf8"),
    durationMs: Date.now() - started,
  };
  await emit(ctx, "tool_result", "write", {
    target: args.path,
    ok: true,
    durationMs: out.durationMs,
    output: previewForLog("write", out),
  });
  return out;
}

/** Default bash wall-clock timeout when the model omits one (ms). */
export const DEFAULT_BASH_TIMEOUT_MS = 60_000;

export async function bashTool(
  ctx: ToolContext,
  args: { command: string; cwd?: string; timeoutMs?: number },
): Promise<ToolResult> {
  const started = Date.now();
  const timeoutMs = args.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS;
  await emit(ctx, "tool_call", "bash", {
    target: args.command,
    input: { ...args, timeoutMs },
  });
  const result = await ctx.sandbox.run(args.command, {
    cwd: args.cwd
      ? resolveInWorkspace(ctx.workspaceRoot, args.cwd)
      : ctx.workspaceRoot,
    timeoutMs,
  });
  // Source safety clip; model-facing head+tail lives in limits.ts.
  const out = {
    ok: result.exitCode === 0,
    tool: "bash",
    exitCode: result.exitCode,
    stdout: truncate(result.stdout, 32_000),
    stderr: truncate(result.stderr, 16_000),
    sandboxMode: result.mode,
    durationMs: Date.now() - started,
  };
  await emit(ctx, "tool_result", "bash", {
    target: args.command,
    ok: out.ok,
    durationMs: out.durationMs,
    detail: `exit ${result.exitCode} (${result.mode})`,
    output: previewForLog("bash", out),
  });
  return out;
}

/** Parallel read-only discovery: grep / glob / read / LSP / intake concurrently. */
export async function parallelReadOnly(
  ctx: ToolContext,
  jobs: Array<
    | { tool: "grep"; args: Parameters<typeof grepTool>[1] }
    | { tool: "glob"; args: Parameters<typeof globTool>[1] }
    | { tool: "read"; args: Parameters<typeof readTool>[1] }
    | { tool: "lsp_diagnostics"; args: Parameters<typeof lspDiagnosticsTool>[1] }
    | { tool: "repo_intake"; args: Parameters<typeof intakeTool>[1] }
  >,
): Promise<ToolResult[]> {
  return Promise.all(
    jobs.map((job) => {
      if (job.tool === "grep") return grepTool(ctx, job.args);
      if (job.tool === "glob") return globTool(ctx, job.args);
      if (job.tool === "read") return readTool(ctx, job.args);
      if (job.tool === "lsp_diagnostics") return lspDiagnosticsTool(ctx, job.args);
      return intakeTool(ctx, job.args);
    }),
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…(truncated ${s.length - max} chars)`;
}

/** Catch tool throws so the agent loop gets a soft error instead of dying. */
async function safeExecute(
  toolName: string,
  run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, tool: toolName, error: message };
  }
}

/**
 * Single truncation layer where tool results enter the message history.
 * The full result is appended to the JSONL trace whenever capping occurred,
 * so nothing is lost — the model sees a marker telling it how to get more.
 */
async function executeForModel(
  ctx: ToolContext,
  toolName: string,
  run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const full = await safeExecute(toolName, run);
  const { result, truncated } = capToolResultForModel(toolName, full);
  if (truncated) {
    await ctx.trace?.append("tool_result", {
      tool: toolName,
      fullOutput: true,
      output: full,
    });
  }
  return result;
}

export type ToolProfile = "full" | "coding";

/** edit / write / bash — shared by full and coding profiles. */
function createMutationAiTools(ctx: ToolContext) {
  return {
    edit: tool({
      description: "Exact string replacement edit in an existing file.",
      parameters: z.object({
        path: z.string(),
        oldString: z.string().describe("Exact text to find"),
        newString: z.string().describe("Replacement text"),
      }),
      execute: async (args) =>
        executeForModel(ctx, "edit", () =>
          editTool(ctx, {
            path: args.path,
            oldString: args.oldString,
            newString: args.newString,
            replaceAll: false,
          }),
        ),
    }),
    write: tool({
      description: "Create or overwrite a text file.",
      parameters: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async (args) =>
        executeForModel(ctx, "write", () => writeTool(ctx, args)),
    }),
    bash: tool({
      description:
        "Run a shell command in the sandboxed workspace (network deny-by-default). Hard timeout ~60s; large stdout/stderr is truncated for context. For long-running/watch commands use bash_bg instead.",
      parameters: z.object({
        command: z.string().describe("Shell command to run"),
      }),
      execute: async (args) =>
        executeForModel(ctx, "bash", async () => {
          const result = await bashTool(ctx, {
            command: args.command,
            timeoutMs: DEFAULT_BASH_TIMEOUT_MS,
          });
          if (ctx.onBenchCheckPass && result.ok && result.exitCode === 0) {
            const cmd = String(args.command ?? "");
            if (
              /\bnode\s+check\.mjs\b/.test(cmd) ||
              /(?:^|[;&|]\s*)node\s+check\.mjs\b/.test(cmd)
            ) {
              ctx.onBenchCheckPass();
            }
          }
          return result;
        }),
    }),
  };
}

/**
 * AI SDK tool map — same implementations, swappable model.
 * Keep schemas minimal: Groq (gpt-oss) rejects optional-only keys and
 * often invents/omits extra fields when schemas are wide.
 * All results pass through the truncation layer before reaching the model.
 */
export function createAiTools(
  ctx: ToolContext,
  opts?: { profile?: ToolProfile },
) {
  const profile = opts?.profile ?? "full";
  const mutation = createMutationAiTools(ctx);

  if (profile === "coding") {
    const ro = createReadOnlyAiTools(ctx);
    return {
      grep: ro.grep,
      glob: ro.glob,
      read: ro.read,
      ...mutation,
    };
  }

  return {
    ...createReadOnlyAiTools(ctx),
    ...createBgShellTools(ctx),
    parallel: tool({
      description:
        "Run up to 6 read-only tools concurrently (grep/glob/read). Prefer emitting multiple tool calls in one step when possible; use this when you want one batched result.",
      parameters: z.object({
        jobs: z
          .array(
            z.object({
              tool: z.enum(["grep", "glob", "read"]),
              pattern: z
                .string()
                .nullable()
                .describe("grep/glob pattern; null for read"),
              path: z
                .string()
                .nullable()
                .describe("File/dir path; required for read"),
            }),
          )
          .min(1)
          .max(6),
      }),
      execute: async (args) =>
        executeForModel(ctx, "parallel", async () => {
          const started = Date.now();
          await emit(ctx, "tool_call", "parallel", {
            target: `${args.jobs.length} jobs`,
            input: args,
          });
          type ParallelJob = Parameters<typeof parallelReadOnly>[1][number];
          const jobs: ParallelJob[] = [];
          for (const j of args.jobs) {
            if (j.tool === "grep") {
              jobs.push({
                tool: "grep",
                args: {
                  pattern: j.pattern ?? "",
                  path: j.path ?? undefined,
                },
              });
            } else if (j.tool === "glob") {
              jobs.push({
                tool: "glob",
                args: { pattern: j.pattern ?? "**/*" },
              });
            } else if (j.path) {
              jobs.push({ tool: "read", args: { path: j.path } });
            }
          }
          const results = await parallelReadOnly(ctx, jobs);
          const out = {
            ok: results.every((r) => r.ok),
            tool: "parallel",
            results,
            count: results.length,
            durationMs: Date.now() - started,
          };
          await emit(ctx, "tool_result", "parallel", {
            target: `${args.jobs.length} jobs`,
            ok: out.ok,
            durationMs: out.durationMs,
            output: previewForLog("parallel", out),
          });
          return out;
        }),
    }),
    ...mutation,
  };
}

/**
 * Read-only tool map — used by the `task` subagent (no edit/write/bash).
 */
export function createReadOnlyAiTools(ctx: ToolContext) {
  return {
    grep: tool({
      description: "Search file contents with ripgrep (or Node fallback).",
      parameters: z.object({
        pattern: z.string().describe("Search pattern"),
        path: z
          .string()
          .nullable()
          .describe("Subdir to search, or null for workspace root"),
      }),
      execute: async (args) =>
        executeForModel(ctx, "grep", () =>
          grepTool(ctx, {
            pattern: args.pattern,
            path: args.path ?? undefined,
          }),
        ),
    }),
    glob: tool({
      description:
        "Find files by glob pattern within the workspace. Use **/* or * to list all files.",
      parameters: z.object({
        pattern: z
          .string()
          .describe("Glob pattern, e.g. **/* or *.ts (empty defaults to **/*)"),
      }),
      execute: async (args) =>
        executeForModel(ctx, "glob", () =>
          globTool(ctx, {
            pattern: args.pattern,
          }),
        ),
    }),
    read: tool({
      description:
        "Read a text file from the workspace. Large files are shown head+tail truncated; pass offset/limit to see a specific line range.",
      parameters: z.object({
        path: z.string().describe("File path relative to workspace"),
        offset: z
          .number()
          .int()
          .positive()
          .nullable()
          .describe("1-based start line, or null for start of file"),
        limit: z
          .number()
          .int()
          .positive()
          .nullable()
          .describe("Max lines to read, or null for all"),
      }),
      execute: async (args) =>
        executeForModel(ctx, "read", () =>
          readTool(ctx, {
            path: args.path,
            offset: args.offset ?? undefined,
            limit: args.limit ?? undefined,
          }),
        ),
    }),
    lsp_definition: tool({
      description:
        "Go to definition via LSP (TypeScript Language Service; Python via pyright when installed). Lines are 1-based.",
      parameters: z.object({
        path: z.string(),
        line: z.number().int().positive(),
        character: z
          .number()
          .int()
          .nonnegative()
          .describe("0-based column"),
      }),
      execute: async (args) =>
        executeForModel(ctx, "lsp_definition", () =>
          lspDefinitionTool(ctx, args),
        ),
    }),
    lsp_references: tool({
      description:
        "Find references via LSP (TS Language Service / pyright). Lines are 1-based.",
      parameters: z.object({
        path: z.string(),
        line: z.number().int().positive(),
        character: z
          .number()
          .int()
          .nonnegative()
          .describe("0-based column"),
      }),
      execute: async (args) =>
        executeForModel(ctx, "lsp_references", () =>
          lspReferencesTool(ctx, args),
        ),
    }),
    lsp_diagnostics: tool({
      description:
        "Get diagnostics for a file or the TS workspace (errors/warnings). Prefer after edits.",
      parameters: z.object({
        path: z
          .string()
          .nullable()
          .describe("File path, or null for workspace-wide (TS)"),
      }),
      execute: async (args) =>
        executeForModel(ctx, "lsp_diagnostics", () =>
          lspDiagnosticsTool(ctx, { path: args.path ?? undefined }),
        ),
    }),
    repo_intake: tool({
      description:
        "Thin repository intake map: languages, entrypoints, configs, test command hints, bounded issue prompt.",
      parameters: z.object({
        path: z
          .string()
          .nullable()
          .describe("Subdir to scan, or null for workspace root"),
      }),
      execute: async (args) =>
        executeForModel(ctx, "repo_intake", () =>
          intakeTool(ctx, { path: args.path ?? undefined }),
        ),
    }),
  };
}
