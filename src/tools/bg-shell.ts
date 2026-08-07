/**
 * tools/bg-shell — AI SDK tools for background shell jobs.
 */

import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./common.js";
import { emitToolEvent } from "./common.js";
import { capToolResultForModel } from "./limits.js";
import { previewForLog } from "./log-preview.js";

async function executeBg(
  ctx: ToolContext,
  toolName: string,
  target: string,
  run: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  await emitToolEvent(ctx, "tool_call", toolName, {
    target,
    input: { target },
  });
  try {
    const body = await run();
    const ok = body.ok !== false;
    const full = { ok, tool: toolName, ...body, durationMs: Date.now() - started };
    const { result, truncated } = capToolResultForModel(toolName, full);
    if (truncated) {
      await ctx.trace?.append("tool_result", {
        tool: toolName,
        fullOutput: true,
        output: full,
      });
    }
    await emitToolEvent(ctx, "tool_result", toolName, {
      target,
      ok,
      durationMs: full.durationMs as number,
      output: previewForLog(toolName, full),
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const full = {
      ok: false,
      tool: toolName,
      error: message,
      durationMs: Date.now() - started,
    };
    await emitToolEvent(ctx, "tool_result", toolName, {
      target,
      ok: false,
      durationMs: full.durationMs,
      detail: message.slice(0, 200),
    });
    return full;
  }
}

/** Background shell + job management tools (needs ctx.shellJobs at execute time). */
export function createBgShellTools(ctx: ToolContext) {
  const requireJobs = () => {
    if (!ctx.shellJobs) {
      throw new Error("background shells unavailable in this session");
    }
    return ctx.shellJobs;
  };

  return {
    bash_bg: tool({
      description:
        "Start a shell command in the background (dev servers, long builds, watchers). Returns a job id immediately — use bash_output / bash_jobs / bash_kill to manage it. Prefer this over foreground bash for commands that may run >30s.",
      parameters: z.object({
        command: z.string().describe("Shell command to run in the background"),
      }),
      execute: async (args) =>
        executeBg(ctx, "bash_bg", args.command, async () => {
          const summary = await requireJobs().start({ command: args.command });
          return { job: summary };
        }),
    }),
    bash_jobs: tool({
      description: "List background shell jobs for this session (id, status, command, exit code).",
      parameters: z.object({
        status: z
          .enum(["all", "running", "done"])
          .describe("Filter: all, running only, or finished (exited/killed/error)"),
      }),
      execute: async (args) =>
        executeBg(ctx, "bash_jobs", args.status, async () => {
          const all = requireJobs().list();
          const filtered =
            args.status === "running"
              ? all.filter((j) => j.status === "running")
              : args.status === "done"
                ? all.filter((j) => j.status !== "running")
                : all;
          return { jobs: filtered, count: filtered.length };
        }),
    }),
    bash_output: tool({
      description:
        "Read stdout/stderr from a background shell job. Pass tail to get only the last N characters of each stream.",
      parameters: z.object({
        id: z.string().describe("Job id from bash_bg / bash_jobs"),
        tail: z
          .number()
          .int()
          .positive()
          .nullable()
          .describe("Max chars per stream from the end, or null for all retained"),
      }),
      execute: async (args) =>
        executeBg(ctx, "bash_output", args.id, async () => {
          const out = requireJobs().output(args.id, {
            tail: args.tail ?? undefined,
          });
          if (!out) {
            return { ok: false, error: `unknown job id: ${args.id}` };
          }
          return { job: out };
        }),
    }),
    bash_kill: tool({
      description: "Kill a background shell job by id (Windows taskkill / Unix SIGTERM).",
      parameters: z.object({
        id: z.string().describe("Job id to terminate"),
      }),
      execute: async (args) =>
        executeBg(ctx, "bash_kill", args.id, async () => {
          const summary = requireJobs().kill(args.id);
          if (!summary) {
            return { ok: false, error: `unknown job id: ${args.id}` };
          }
          return { job: summary };
        }),
    }),
  };
}
