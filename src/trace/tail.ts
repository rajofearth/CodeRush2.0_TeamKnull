/**
 * trace/tail — reusable read-only tailer for `.clai/traces/<runId>/events.jsonl`.
 *
 * Separate process / consumer only — never blocks the writer. Polls with an
 * optional fs.watch hint; batches notifications for the caller.
 */

import { watch, type FSWatcher } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type TraceLine = {
  /** Absolute path of the events.jsonl being read. */
  filePath: string;
  runId: string;
  /** Parsed JSON object, or null if the line was not valid JSON. */
  event: Record<string, unknown> | null;
  /** Raw line text (without trailing newline). */
  raw: string;
};

export type TraceTailOptions = {
  /** Workspace `.clai/traces` directory. */
  tracesDir: string;
  /** Pin to a run id. When omitted, follow the most recently modified run. */
  runId?: string;
  /** When true (default if no runId), auto-switch to newer runs. */
  followLatest?: boolean;
  /**
   * Byte offset to begin reading. When set (e.g. after an external replay),
   * existing lines are skipped. Cleared when follow-latest switches runs.
   */
  initialOffset?: number;
  /** Poll interval when watch is unavailable or as a fallback (ms). */
  pollIntervalMs?: number;
  /** Called for each newly observed JSONL line. */
  onLine: (line: TraceLine) => void;
  /** Called when the active run directory changes (follow-latest). */
  onRunChange?: (runId: string | null, filePath: string | null) => void;
  /** Called with a human-readable waiting / status message. */
  onStatus?: (message: string) => void;
  /** Called on non-fatal IO errors. */
  onError?: (error: Error) => void;
};

export type TraceTailHandle = {
  /** Currently tailed run id, or null while waiting. */
  readonly runId: string | null;
  /** Absolute events.jsonl path, or null while waiting. */
  readonly filePath: string | null;
  stop: () => void;
};

async function listRunDirs(tracesDir: string): Promise<
  { runId: string; mtimeMs: number; eventsPath: string }[]
> {
  let entries;
  try {
    entries = await readdir(tracesDir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const runs: { runId: string; mtimeMs: number; eventsPath: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const eventsPath = path.join(tracesDir, entry.name, "events.jsonl");
    try {
      const s = await stat(eventsPath);
      runs.push({ runId: entry.name, mtimeMs: s.mtimeMs, eventsPath });
    } catch {
      // run dir without events yet — use dir mtime so follow-latest can pick it
      try {
        const s = await stat(path.join(tracesDir, entry.name));
        runs.push({
          runId: entry.name,
          mtimeMs: s.mtimeMs,
          eventsPath,
        });
      } catch {
        /* skip */
      }
    }
  }
  runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return runs;
}

async function resolveTarget(
  tracesDir: string,
  runId: string | undefined,
  followLatest: boolean,
): Promise<{ runId: string; eventsPath: string } | null> {
  if (runId) {
    return {
      runId,
      eventsPath: path.join(tracesDir, runId, "events.jsonl"),
    };
  }
  if (!followLatest) return null;
  const runs = await listRunDirs(tracesDir);
  const top = runs[0];
  return top ? { runId: top.runId, eventsPath: top.eventsPath } : null;
}

/**
 * Start tailing a trace file. Replays existing content from offset 0, then
 * follows new appends. Safe when the file does not exist yet.
 */
export function startTraceTail(opts: TraceTailOptions): TraceTailHandle {
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const followLatest = opts.runId ? false : opts.followLatest !== false;

  let stopped = false;
  let activeRunId: string | null = null;
  let activePath: string | null = null;
  let offset = opts.initialOffset ?? 0;
  let carry = "";
  let appliedInitialOffset = opts.initialOffset != null;
  let watcher: FSWatcher | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let runScanTimer: ReturnType<typeof setInterval> | null = null;
  let reading = false;

  const handle: TraceTailHandle = {
    get runId() {
      return activeRunId;
    },
    get filePath() {
      return activePath;
    },
    stop() {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (runScanTimer) clearInterval(runScanTimer);
      pollTimer = null;
      runScanTimer = null;
      try {
        watcher?.close();
      } catch {
        /* ignore */
      }
      watcher = null;
    },
  };

  const emitLines = (chunk: string, filePath: string, runId: string) => {
    const combined = carry + chunk;
    const parts = combined.split("\n");
    carry = parts.pop() ?? "";
    for (const raw of parts) {
      if (!raw.trim()) continue;
      let event: Record<string, unknown> | null = null;
      try {
        event = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        event = null;
      }
      opts.onLine({ filePath, runId, event, raw });
    }
  };

  const readNew = async () => {
    if (stopped || reading || !activePath || !activeRunId) return;
    reading = true;
    try {
      let s;
      try {
        s = await stat(activePath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          opts.onStatus?.(`waiting for run… (${activeRunId})`);
          return;
        }
        throw err;
      }
      if (s.size < offset) {
        // truncated / replaced
        offset = 0;
        carry = "";
      }
      if (s.size === offset) return;
      const fh = await open(activePath, "r");
      try {
        const length = s.size - offset;
        const buf = Buffer.alloc(length);
        const { bytesRead } = await fh.read(buf, 0, length, offset);
        offset += bytesRead;
        emitLines(buf.subarray(0, bytesRead).toString("utf8"), activePath, activeRunId);
      } finally {
        await fh.close();
      }
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      reading = false;
    }
  };

  const attachWatcher = (filePath: string) => {
    try {
      watcher?.close();
    } catch {
      /* ignore */
    }
    watcher = null;
    try {
      watcher = watch(filePath, () => {
        void readNew();
      });
      watcher.on("error", () => {
        // fall back to polling only
        try {
          watcher?.close();
        } catch {
          /* ignore */
        }
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  };

  const switchTo = async (runId: string, eventsPath: string, replay: boolean) => {
    if (stopped) return;
    if (activeRunId === runId && activePath === eventsPath && !replay) {
      await readNew();
      return;
    }
    activeRunId = runId;
    activePath = eventsPath;
    if (appliedInitialOffset) {
      // Keep caller-supplied offset for the first attach only.
      appliedInitialOffset = false;
    } else {
      offset = 0;
      carry = "";
    }
    opts.onRunChange?.(runId, eventsPath);
    opts.onStatus?.(`watching ${runId}`);
    attachWatcher(eventsPath);
    // Also watch the parent dir so we notice file creation
    try {
      const dir = path.dirname(eventsPath);
      watch(dir, () => {
        void readNew();
      });
    } catch {
      /* ignore */
    }
    await readNew();
  };

  const scan = async () => {
    if (stopped) return;
    try {
      const target = await resolveTarget(opts.tracesDir, opts.runId, followLatest);
      if (!target) {
        if (!activeRunId) opts.onStatus?.("waiting for run…");
        return;
      }
      if (followLatest && activeRunId && target.runId !== activeRunId) {
        // Prefer a strictly newer mtime when switching
        const runs = await listRunDirs(opts.tracesDir);
        const current = runs.find((r) => r.runId === activeRunId);
        const next = runs.find((r) => r.runId === target.runId);
        if (current && next && next.mtimeMs >= current.mtimeMs) {
          await switchTo(target.runId, target.eventsPath, true);
          return;
        }
      }
      if (!activeRunId) {
        await switchTo(target.runId, target.eventsPath, true);
      } else {
        await readNew();
      }
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Initial resolve + poll fallback
  void scan();
  pollTimer = setInterval(() => {
    void readNew();
  }, pollIntervalMs);
  if (followLatest || !opts.runId) {
    runScanTimer = setInterval(() => {
      void scan();
    }, Math.max(pollIntervalMs * 2, 500));
  }

  return handle;
}

/** Read an entire events.jsonl file (replay). Missing file → []. */
export async function readTraceFile(
  filePath: string,
): Promise<Record<string, unknown>[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* skip bad lines */
    }
  }
  return out;
}

/** Most recently modified run under tracesDir, or null. */
export async function findLatestRun(
  tracesDir: string,
): Promise<{ runId: string; eventsPath: string; mtimeMs: number } | null> {
  const runs = await listRunDirs(tracesDir);
  const top = runs[0];
  return top
    ? { runId: top.runId, eventsPath: top.eventsPath, mtimeMs: top.mtimeMs }
    : null;
}
