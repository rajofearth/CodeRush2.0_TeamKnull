/**
 * glass/cli — `clai glass [--run <runId>] [--follow-latest]`
 *
 * Second-terminal observability pane over `.clai/traces/<runId>/events.jsonl`.
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import {
  findLatestRun,
  readTraceFile,
  startTraceTail,
} from "../trace/index.js";
import {
  initialGlassState,
  reduceGlassEvent,
  renderGlassPane,
  type GlassState,
} from "../ui-glass/app.js";

export type GlassCliOptions = {
  tracesDir: string;
  cwd: string;
  args: string[];
};

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("-")) {
    return args[i + 1];
  }
  const eq = args.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

export async function runGlassCli(opts: GlassCliOptions): Promise<number> {
  const runIdFlag = flagValue(opts.args, "--run");
  const followLatest = opts.args.includes("--follow-latest") || !runIdFlag;
  const dataDirFlag = flagValue(opts.args, "--data-dir");
  const tracesDir = dataDirFlag
    ? path.resolve(dataDirFlag, "traces")
    : opts.tracesDir;

  if (!process.stdout.isTTY) {
    console.error(
      "clai glass needs a TTY. Open a second terminal beside your clai session.",
    );
    return 1;
  }

  const stateRef: { current: GlassState } = {
    current: {
      ...initialGlassState(),
      statusMessage: runIdFlag
        ? `loading run ${runIdFlag}…`
        : "waiting for run…",
    },
  };

  const applyEvent = (event: Record<string, unknown> | null) => {
    if (!event) return;
    stateRef.current = reduceGlassEvent(stateRef.current, event);
  };

  let initialOffset: number | undefined;

  // Pinned run: replay from the start (demo-safe), then follow only new bytes.
  if (runIdFlag) {
    const eventsPath = path.join(tracesDir, runIdFlag, "events.jsonl");
    stateRef.current = {
      ...stateRef.current,
      runId: runIdFlag,
      statusMessage: `replaying ${runIdFlag}`,
    };
    const events = await readTraceFile(eventsPath);
    for (const event of events) applyEvent(event);
    try {
      initialOffset = (await stat(eventsPath)).size;
    } catch {
      initialOffset = 0;
    }
    if (events.length === 0) {
      stateRef.current = {
        ...stateRef.current,
        statusMessage: `waiting for run… (${runIdFlag})`,
      };
    } else {
      const ended = events.some((e) => e.type === "run_end");
      stateRef.current = {
        ...stateRef.current,
        runComplete: ended,
        statusMessage: ended
          ? `run complete · replay ${runIdFlag}`
          : `watching ${runIdFlag}`,
      };
    }
  } else {
    const latest = await findLatestRun(tracesDir);
    if (latest) {
      stateRef.current = {
        ...stateRef.current,
        runId: latest.runId,
        statusMessage: `watching ${latest.runId}`,
      };
    }
  }

  const pane = await renderGlassPane({ stateRef });

  const sessionStats = () => stateRef.current.stats;

  const tail = startTraceTail({
    tracesDir,
    runId: runIdFlag,
    followLatest,
    initialOffset,
    pollIntervalMs: 200,
    onRunChange: (id) => {
      // Follow-latest switched runs — reset pipeline, keep session counters.
      if (runIdFlag) return; // pinned
      stateRef.current = {
        ...initialGlassState(),
        runId: id,
        statusMessage: id ? `watching ${id}` : "waiting for run…",
        stats: sessionStats(),
      };
    },
    onStatus: (message) => {
      if (!stateRef.current.runId || stateRef.current.runComplete) {
        stateRef.current = { ...stateRef.current, statusMessage: message };
      }
    },
    onLine: (line) => {
      if (line.runId && stateRef.current.runId !== line.runId) {
        stateRef.current = {
          ...stateRef.current,
          runId: line.runId,
        };
      }
      applyEvent(line.event);
    },
    onError: (err) => {
      stateRef.current = {
        ...stateRef.current,
        statusMessage: `tail error: ${err.message}`,
      };
    },
  });

  try {
    await pane.waitUntilExit();
  } finally {
    tail.stop();
    pane.unmount();
  }
  return 0;
}
