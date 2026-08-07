/**
 * shell/jobs — session-scoped background shell processes.
 *
 * Modeled after Claude Code / OpenCode bg bash: spawn returns a job id
 * immediately; the agent polls output / kills via dedicated tools.
 * Jobs are in-memory for the session (no cross-restart persistence).
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { ApprovalHook } from "../sandbox/index.js";

const SECRET_ENV_RE =
  /^(.*_(API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN)$/i;

const DESTRUCTIVE_RE =
  /\b(rm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r)|del\s+\/[sq]|format\s+|mkfs\.|dd\s+if=|>\s*\/dev\/|Remove-Item\s+.*-Recurse)\b/i;

const EGRESS_RE =
  /\b(curl|wget|Invoke-WebRequest|fetch\(|npm\s+publish|pnpm\s+publish)\b/i;

/** Cap retained stdout+stderr per job (chars). */
const OUTPUT_CAP = 256_000;

export type BgShellStatus = "running" | "exited" | "killed" | "error";

export type BgShellSummary = {
  id: string;
  command: string;
  cwd: string;
  status: BgShellStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  pid?: number;
  stdoutBytes: number;
  stderrBytes: number;
};

export type BgShellOutput = BgShellSummary & {
  stdout: string;
  stderr: string;
  truncated: boolean;
};

type InternalJob = {
  summary: BgShellSummary;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

function scrubEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (v == null) continue;
    if (SECRET_ENV_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function appendCapped(
  job: InternalJob,
  stream: "stdout" | "stderr",
  chunk: string,
): void {
  const cur = job[stream];
  const next = cur + chunk;
  if (next.length <= OUTPUT_CAP) {
    job[stream] = next;
  } else {
    job.truncated = true;
    job[stream] = next.slice(next.length - OUTPUT_CAP);
  }
  job.summary.stdoutBytes = Buffer.byteLength(job.stdout, "utf8");
  job.summary.stderrBytes = Buffer.byteLength(job.stderr, "utf8");
}

function killChild(child: ChildProcess): void {
  if (child.killed || child.exitCode != null) return;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        if (!child.killed && child.exitCode == null) child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 2_000).unref?.();
  }
}

export class ShellJobManager {
  private jobs = new Map<string, InternalJob>();
  private seq = 0;
  private disposed = false;

  constructor(
    private readonly opts: {
      workspaceRoot: string;
      requestApproval: ApprovalHook;
    },
  ) {}

  async start(args: {
    command: string;
    cwd?: string;
  }): Promise<BgShellSummary> {
    if (this.disposed) {
      throw new Error("shell job manager disposed");
    }
    const command = args.command.trim();
    if (!command) throw new Error("command is empty");

    const cwd = args.cwd
      ? path.resolve(this.opts.workspaceRoot, args.cwd)
      : this.opts.workspaceRoot;
    const rel = path.relative(this.opts.workspaceRoot, cwd);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`cwd escapes workspace: ${args.cwd}`);
    }

    if (DESTRUCTIVE_RE.test(command)) {
      const ok = await this.opts.requestApproval({
        kind: "destructive",
        tool: "bash_bg",
        detail: command,
        command,
      });
      if (!ok) throw new Error("destructive command denied");
    }
    if (EGRESS_RE.test(command)) {
      const ok = await this.opts.requestApproval({
        kind: "egress",
        tool: "bash_bg",
        detail: command,
        command,
      });
      if (!ok) throw new Error("egress command denied");
    }

    this.seq += 1;
    const id = `bg-${this.seq.toString(16)}`;
    const startedAt = new Date().toISOString();

    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", command], {
            cwd,
            env: scrubEnv(),
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          })
        : spawn("bash", ["-lc", command], {
            cwd,
            env: scrubEnv(),
            stdio: ["ignore", "pipe", "pipe"],
          });

    const summary: BgShellSummary = {
      id,
      command,
      cwd: path.relative(this.opts.workspaceRoot, cwd) || ".",
      status: "running",
      startedAt,
      pid: child.pid,
      stdoutBytes: 0,
      stderrBytes: 0,
    };
    const job: InternalJob = {
      summary,
      child,
      stdout: "",
      stderr: "",
      truncated: false,
    };
    this.jobs.set(id, job);

    child.stdout?.on("data", (buf: Buffer) => {
      appendCapped(job, "stdout", buf.toString("utf8"));
    });
    child.stderr?.on("data", (buf: Buffer) => {
      appendCapped(job, "stderr", buf.toString("utf8"));
    });
    child.on("error", (err) => {
      if (job.summary.status !== "running") return;
      job.summary.status = "error";
      job.summary.endedAt = new Date().toISOString();
      appendCapped(job, "stderr", `\n${err.message}`);
    });
    child.on("close", (code) => {
      if (job.summary.status === "killed") {
        job.summary.endedAt = job.summary.endedAt ?? new Date().toISOString();
        return;
      }
      job.summary.status = "exited";
      job.summary.exitCode = code;
      job.summary.endedAt = new Date().toISOString();
    });

    return { ...summary };
  }

  list(): BgShellSummary[] {
    return [...this.jobs.values()].map((j) => ({ ...j.summary }));
  }

  output(
    id: string,
    opts?: { tail?: number },
  ): BgShellOutput | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    const tail = opts?.tail && opts.tail > 0 ? opts.tail : undefined;
    const slice = (s: string) =>
      tail && s.length > tail ? s.slice(s.length - tail) : s;
    return {
      ...job.summary,
      stdout: slice(job.stdout),
      stderr: slice(job.stderr),
      truncated: job.truncated || Boolean(tail && (job.stdout.length > (tail ?? 0) || job.stderr.length > (tail ?? 0))),
    };
  }

  kill(id: string): BgShellSummary | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.summary.status === "running") {
      job.summary.status = "killed";
      job.summary.endedAt = new Date().toISOString();
      killChild(job.child);
    }
    return { ...job.summary };
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.jobs.values()) {
      if (job.summary.status === "running") {
        job.summary.status = "killed";
        job.summary.endedAt = new Date().toISOString();
        killChild(job.child);
      }
    }
    this.jobs.clear();
  }
}
