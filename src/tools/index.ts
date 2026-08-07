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
        output: { count: matches.length, engine: "rg" },
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
    output: { count: matches.length, engine: "node" },
  });
  return out;
}

export async function globTool(
  ctx: ToolContext,
  args: { pattern: string; path?: string; maxResults?: number },
): Promise<ToolResult> {
  const started = Date.now();
  const searchRoot = args.path
    ? resolveInWorkspace(ctx.workspaceRoot, args.path)
    : ctx.workspaceRoot;
  await emit(ctx, "tool_call", "glob", {
    target: args.pattern,
    input: args,
  });
  const files = await fg(args.pattern, {
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
    durationMs: Date.now() - started,
  };
  await emit(ctx, "tool_result", "glob", {
    target: args.pattern,
    ok: true,
    durationMs: out.durationMs,
    output: { count: out.count },
  });
  return out;
}

export async function readTool(
  ctx: ToolContext,
  args: { path: string; offset?: number; limit?: number },
): Promise<ToolResult> {
  const started = Date.now();
  const abs = resolveInWorkspace(ctx.workspaceRoot, args.path);
  await emit(ctx, "tool_call", "read", { target: args.path, input: args });
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
    output: { totalLines: lines.length, shown: slice.length },
  });
  return out;
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
  });
  return out;
}

export async function bashTool(
  ctx: ToolContext,
  args: { command: string; cwd?: string; timeoutMs?: number },
): Promise<ToolResult> {
  const started = Date.now();
  await emit(ctx, "tool_call", "bash", {
    target: args.command,
    input: args,
  });
  const result = await ctx.sandbox.run(args.command, {
    cwd: args.cwd
      ? resolveInWorkspace(ctx.workspaceRoot, args.cwd)
      : ctx.workspaceRoot,
    timeoutMs: args.timeoutMs,
  });
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
    output: { exitCode: result.exitCode, sandboxMode: result.mode },
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

/** AI SDK tool map — same implementations, swappable model. */
export function createAiTools(ctx: ToolContext) {
  return {
    grep: tool({
      description: "Search file contents with ripgrep (or Node fallback).",
      parameters: z.object({
        pattern: z.string(),
        path: z.string().optional(),
        glob: z.string().optional(),
        caseInsensitive: z.boolean().optional(),
        maxResults: z.number().int().positive().optional(),
      }),
      execute: async (args) => grepTool(ctx, args),
    }),
    glob: tool({
      description: "Find files by glob pattern within the workspace.",
      parameters: z.object({
        pattern: z.string(),
        path: z.string().optional(),
        maxResults: z.number().int().positive().optional(),
      }),
      execute: async (args) => globTool(ctx, args),
    }),
    read: tool({
      description: "Read a text file (optional offset/limit by line).",
      parameters: z.object({
        path: z.string(),
        offset: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => readTool(ctx, args),
    }),
    edit: tool({
      description: "Exact string replacement edit in an existing file.",
      parameters: z.object({
        path: z.string(),
        oldString: z.string(),
        newString: z.string(),
        replaceAll: z.boolean().optional(),
      }),
      execute: async (args) => editTool(ctx, args),
    }),
    write: tool({
      description: "Create or overwrite a text file.",
      parameters: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async (args) => writeTool(ctx, args),
    }),
    bash: tool({
      description:
        "Run a shell command in the sandboxed workspace (network deny-by-default).",
      parameters: z.object({
        command: z.string(),
        cwd: z.string().optional(),
        timeoutMs: z.number().int().positive().optional(),
      }),
      execute: async (args) => bashTool(ctx, args),
    }),
    lsp_definition: tool({
      description:
        "Go to definition via LSP (TypeScript Language Service; Python via pyright when installed). Lines are 1-based.",
      parameters: z.object({
        path: z.string(),
        line: z.number().int().positive(),
        character: z.number().int().nonnegative().optional(),
      }),
      execute: async (args) => lspDefinitionTool(ctx, args),
    }),
    lsp_references: tool({
      description:
        "Find references via LSP (TS Language Service / pyright). Lines are 1-based.",
      parameters: z.object({
        path: z.string(),
        line: z.number().int().positive(),
        character: z.number().int().nonnegative().optional(),
      }),
      execute: async (args) => lspReferencesTool(ctx, args),
    }),
    lsp_diagnostics: tool({
      description:
        "Get diagnostics for a file or the TS workspace (errors/warnings). Prefer after edits.",
      parameters: z.object({
        path: z.string().optional(),
      }),
      execute: async (args) => lspDiagnosticsTool(ctx, args),
    }),
    repo_intake: tool({
      description:
        "Thin repository intake map: languages, entrypoints, configs, test command hints, bounded issue prompt.",
      parameters: z.object({
        path: z.string().optional(),
      }),
      execute: async (args) => intakeTool(ctx, args),
    }),
  };
}
