/**
 * sandbox — Shell sandbox seam wrapping `@anthropic-ai/sandbox-runtime`.
 * Graceful stub fallback when the package or platform primitives fail
 * (e.g. Windows ARM without matching binaries).
 */

import { execa } from "execa";
import path from "node:path";

export type ApprovalKind = "egress" | "destructive" | "out_of_repo";

export type ApprovalRequest = {
  kind: ApprovalKind;
  tool: string;
  detail: string;
  command?: string;
  path?: string;
};

export type ApprovalHook = (req: ApprovalRequest) => Promise<boolean>;

export type SandboxMode = "runtime" | "stub";

export type RunCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  mode: SandboxMode;
  command: string;
  wrappedCommand?: string;
  durationMs: number;
};

export type SandboxHandle = {
  mode: SandboxMode;
  workspaceRoot: string;
  /** Why stub mode was chosen, if applicable. */
  stubReason?: string;
  run: (command: string, opts?: { cwd?: string; timeoutMs?: number }) => Promise<RunCommandResult>;
  requestApproval: ApprovalHook;
  dispose: () => Promise<void>;
};

export type CreateSandboxOptions = {
  workspaceRoot: string;
  /** Network deny-by-default; allowlisted domains only when explicitly set. */
  allowedDomains?: string[];
  /** Approval hook — default denies egress / out-of-repo / destructive patterns. */
  onApproval?: ApprovalHook;
  /** Auto-approve for offline demos (still records approval events via caller). */
  autoApprove?: boolean;
  /** Force scrubbed stub (no sandbox-runtime). Use for parallel bench to avoid EPERM thrash. */
  forceStub?: boolean;
};

const SECRET_ENV_RE =
  /^(.*_(API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN)$/i;

const DESTRUCTIVE_RE =
  /\b(rm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r)|del\s+\/[sq]|format\s+|mkfs\.|dd\s+if=|>\s*\/dev\/|Remove-Item\s+.*-Recurse)\b/i;

/** Default wall-clock timeout for sandboxed bash (ms). */
export const DEFAULT_BASH_TIMEOUT_MS = 60_000;

/** Source-level capture cap before model-facing truncation (chars per stream). */
export const BASH_CAPTURE_MAX_CHARS = 64_000;

function scrubEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (v == null) continue;
    if (SECRET_ENV_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function clipCapture(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…(truncated ${text.length - maxChars} chars at source)`;
}

function defaultApproval(autoApprove: boolean): ApprovalHook {
  return async (req) => {
    if (autoApprove) return true;
    if (req.kind === "egress") return false;
    if (req.kind === "destructive") return false;
    if (req.kind === "out_of_repo") return false;
    return true;
  };
}

function looksLikeEgress(command: string): boolean {
  return /\b(curl|wget|Invoke-WebRequest|fetch\(|npm\s+publish|pnpm\s+publish)\b/i.test(
    command,
  );
}

/**
 * Create a sandbox handle. Prefer `@anthropic-ai/sandbox-runtime`; fall back to
 * a structured stub that still scrubs env and applies approval hooks.
 */
export async function createSandbox(
  opts: CreateSandboxOptions,
): Promise<SandboxHandle> {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const onApproval = opts.onApproval ?? defaultApproval(opts.autoApprove ?? false);
  let mode: SandboxMode = "stub";
  let stubReason: string | undefined = "sandbox-runtime not initialized";
  let runtime: {
    wrapWithSandbox: (command: string) => Promise<string>;
    reset: () => Promise<void>;
  } | null = null;

  const forceStub =
    opts.forceStub === true || process.env.CLAI_SANDBOX_MODE === "stub";
  if (forceStub) {
    stubReason = opts.forceStub
      ? "forceStub: scrubbed stub (bench / parallel)"
      : 'CLAI_SANDBOX_MODE=stub: scrubbed stub (no sandbox-runtime)';
    mode = "stub";
    runtime = null;
  } else {
    try {
      const mod = await import("@anthropic-ai/sandbox-runtime");
      const SandboxManager = mod.SandboxManager;
      if (!SandboxManager?.initialize || !SandboxManager?.wrapWithSandbox) {
        stubReason = "sandbox-runtime missing SandboxManager API";
      } else {
        const supported =
          typeof SandboxManager.isSupportedPlatform === "function"
            ? SandboxManager.isSupportedPlatform()
            : true;
        if (!supported) {
          stubReason = "platform not supported by sandbox-runtime";
        } else {
          const windowsConfig =
            process.platform === "win32" && mod.VENDORED_SRT_WIN_EXE
              ? { srtWin: { path: mod.VENDORED_SRT_WIN_EXE } }
              : undefined;
          const initPromise = SandboxManager.initialize({
            network: {
              allowedDomains: opts.allowedDomains ?? [],
              deniedDomains: [],
            },
            filesystem: {
              denyRead: [],
              allowWrite: [workspaceRoot],
              denyWrite: [
                path.join(workspaceRoot, ".env"),
                path.join(workspaceRoot, ".env.local"),
              ],
              allowRead: [workspaceRoot],
            },
            ...(windowsConfig ? { windows: windowsConfig } : {}),
          });
          // Avoid hanging on UAC / native install prompts during demos.
          const timeoutMs = 8_000;
          await Promise.race([
            initPromise,
            new Promise((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `sandbox-runtime initialize timed out after ${timeoutMs}ms`,
                    ),
                  ),
                timeoutMs,
              ),
            ),
          ]);
          runtime = {
            wrapWithSandbox: (command: string) =>
              SandboxManager.wrapWithSandbox(command),
            reset: async () => {
              if (typeof SandboxManager.reset === "function") {
                await SandboxManager.reset();
              }
            },
          };
          mode = "runtime";
          stubReason = undefined;
        }
      }
    } catch (err) {
      stubReason =
        err instanceof Error
          ? `sandbox-runtime unavailable: ${err.message}`
          : "sandbox-runtime unavailable";
      mode = "stub";
      runtime = null;
    }
  }

  const requestApproval: ApprovalHook = onApproval;

  return {
    mode,
    workspaceRoot,
    stubReason,
    requestApproval,
    run: async (command, runOpts = {}) => {
      const cwd = path.resolve(runOpts.cwd ?? workspaceRoot);
      if (!cwd.startsWith(workspaceRoot)) {
        const ok = await requestApproval({
          kind: "out_of_repo",
          tool: "bash",
          detail: `cwd outside workspace: ${cwd}`,
          command,
          path: cwd,
        });
        if (!ok) {
          return {
            exitCode: 126,
            stdout: "",
            stderr: "blocked: out-of-repo cwd (approval denied)",
            mode,
            command,
            durationMs: 0,
          };
        }
      }

      if (looksLikeEgress(command)) {
        const ok = await requestApproval({
          kind: "egress",
          tool: "bash",
          detail: "command appears to perform network egress",
          command,
        });
        if (!ok) {
          return {
            exitCode: 126,
            stdout: "",
            stderr: "blocked: egress (approval denied; network deny-by-default)",
            mode,
            command,
            durationMs: 0,
          };
        }
      }

      if (DESTRUCTIVE_RE.test(command)) {
        const ok = await requestApproval({
          kind: "destructive",
          tool: "bash",
          detail: "command matches destructive pattern",
          command,
        });
        if (!ok) {
          return {
            exitCode: 126,
            stdout: "",
            stderr: "blocked: destructive command (approval denied)",
            mode,
            command,
            durationMs: 0,
          };
        }
      }

      let wrapped = command;
      if (runtime) {
        try {
          wrapped = await runtime.wrapWithSandbox(command);
        } catch (err) {
          // Fall through to stub execution if wrap fails mid-run.
          stubReason =
            err instanceof Error
              ? `wrapWithSandbox failed: ${err.message}`
              : "wrapWithSandbox failed";
        }
      }

      const started = Date.now();
      const timeoutMs = runOpts.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS;
      // Effective mode: wrap failure falls through to scrubbed stub exec.
      const effectiveMode: SandboxMode =
        runtime && wrapped !== command ? "runtime" : "stub";
      // Stub and runtime paths share scrubEnv + timeout + output caps.
      try {
        const result = await execa(wrapped, {
          shell: true,
          cwd,
          env: scrubEnv(),
          reject: false,
          timeout: timeoutMs,
          maxBuffer: BASH_CAPTURE_MAX_CHARS,
          all: false,
        });
        let stdout = clipCapture(result.stdout ?? "", BASH_CAPTURE_MAX_CHARS);
        let stderr = clipCapture(result.stderr ?? "", BASH_CAPTURE_MAX_CHARS);
        if (result.timedOut) {
          stderr = `${stderr}${stderr ? "\n" : ""}timed out after ${timeoutMs}ms`;
        }
        return {
          exitCode: result.timedOut ? 124 : (result.exitCode ?? 1),
          stdout,
          stderr,
          mode: effectiveMode,
          command,
          wrappedCommand: wrapped !== command ? wrapped : undefined,
          durationMs: Date.now() - started,
        };
      } catch (err) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: err instanceof Error ? err.message : String(err),
          mode: effectiveMode,
          command,
          wrappedCommand: wrapped !== command ? wrapped : undefined,
          durationMs: Date.now() - started,
        };
      }
    },
    dispose: async () => {
      if (runtime) {
        try {
          await runtime.reset();
        } catch {
          /* ignore teardown errors */
        }
      }
    },
  };
}

/** Sync env scrub helper for callers that spawn outside `run`. */
export { scrubEnv };
