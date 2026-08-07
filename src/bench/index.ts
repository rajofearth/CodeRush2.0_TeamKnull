/**
 * bench — CLAI benchmark CLI entry.
 *
 * Parent wiring (do NOT edit src/cli.tsx from this module — parent owns it):
 *
 *   import { runBenchCli } from "./bench/index.js";
 *   // when entry.subcommand === "bench":
 *   const code = await runBenchCli(args.slice(1), workspace.root);
 *   process.exit(code);
 *
 * Signature:
 *   runBenchCli(args: string[], workspaceRoot: string): Promise<number>
 *
 * Subcommands (args[0]):
 *   run [--offline] [--parallel N] [--tasks id,id] [--serve] [--port N]
 *   serve [--port N]
 *   list
 *
 * Exit codes: 0 success, 1 usage / fatal error.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBenchTasks, runBench } from "./runner.js";
import { startBenchServer, DEFAULT_BENCH_PORT } from "./server.js";
import { BenchStore, LiveRunFeed } from "./store.js";

export type { BenchRunRecord, BenchTaskSpec, TaskResult, LiveSnapshot } from "./types.js";
export { computeAggregates } from "./types.js";
export { loadBenchTasks, runBench } from "./runner.js";
export { BenchStore, LiveRunFeed } from "./store.js";
export { startBenchServer, DEFAULT_BENCH_PORT } from "./server.js";

const USAGE = `Usage:
  clai bench [--serve] [--port N]          # alias for serve
  clai bench run [--offline] [--parallel N] [--tasks id,id] [--serve] [--port N]
  clai bench serve [--port N]
  clai bench list

Options:
  --offline       Apply fixture _solution/ patches (no API key)
  --parallel N    Concurrent tasks (default: 1 live / 3 offline)
  --tasks id,id   Subset of task ids
  --serve         With run: start live dashboard and keep it up
  --port N        Dashboard port (default ${DEFAULT_BENCH_PORT})
`;

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("-")) {
    return args[i + 1];
  }
  const eq = args.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name) || args.some((a) => a.startsWith(`${name}=`));
}

function parseParallel(args: string[], offline: boolean): number {
  const raw = flagValue(args, "--parallel");
  if (raw == null) {
    // Live Gemini quotas die under parallel=3; default serial for live runs.
    return offline ? 3 : 1;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`invalid --parallel value: ${raw}`);
  }
  return Math.floor(n);
}

function parsePort(args: string[]): number {
  const raw = flagValue(args, "--port");
  if (raw == null) return DEFAULT_BENCH_PORT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 65535) {
    throw new Error(`invalid --port value: ${raw}`);
  }
  return Math.floor(n);
}

function parseTaskIds(args: string[]): string[] | undefined {
  const raw = flagValue(args, "--tasks");
  if (raw == null) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? ids : undefined;
}

/** Resolve fixtures/bench relative to this package (not the user's cwd). */
export function resolveBenchFixturesRoot(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "fixtures",
    "bench",
  );
}

function waitForInterrupt(): Promise<void> {
  return new Promise((resolve) => {
    const onSig = () => {
      process.off("SIGINT", onSig);
      process.off("SIGTERM", onSig);
      resolve();
    };
    process.on("SIGINT", onSig);
    process.on("SIGTERM", onSig);
  });
}

function printRunSummary(record: Awaited<ReturnType<typeof runBench>>): void {
  const a = record.aggregates;
  const tokens = (Number(a.totalTokensIn) || 0) + (Number(a.totalTokensOut) || 0);
  const cost = Number.isFinite(Number(a.totalCost)) ? Number(a.totalCost) : 0;
  console.log("");
  console.log(
    `bench ${record.runId}  ${a.passed}/${a.total} pass` +
      `  (${Math.round(a.passRate * 100)}%)` +
      `  wall=${a.totalWallMs}ms` +
      `  tokens=${tokens}` +
      `  cost=$${cost.toFixed(4)}` +
      (record.offline ? "  [offline]" : `  [${record.provider}/${record.model}]`),
  );
  for (const t of record.tasks) {
    const mark =
      t.status === "pass" ? "PASS" : t.status === "fail" ? "FAIL" : t.status.toUpperCase();
    const err =
      t.error && /quota|rate.?limit|429/i.test(t.error)
        ? "  [quota/rate-limit]"
        : t.error
          ? `  ${t.error.slice(0, 120)}`
          : "";
    console.log(
      `  ${mark.padEnd(7)} ${t.id.padEnd(22)} ${String(t.wallMs).padStart(6)}ms` + err,
    );
  }
}

/**
 * CLI entry for `clai bench …`.
 * @param args argv after the `bench` token (e.g. `["run", "--offline"]`)
 * @param workspaceRoot where `.clai/bench/` history + traces are written
 */
export async function runBenchCli(
  args: string[],
  workspaceRoot: string,
): Promise<number> {
  // `clai bench --serve` / bare flags → normalize to a subcommand
  let argv = args;
  if (argv[0]?.startsWith("-")) {
    if (hasFlag(argv, "--serve") || hasFlag(argv, "--port")) {
      argv = ["serve", ...argv.filter((a) => a !== "--serve")];
    } else if (
      hasFlag(argv, "--offline") ||
      hasFlag(argv, "--tasks") ||
      hasFlag(argv, "--parallel")
    ) {
      argv = ["run", ...argv];
    }
  }
  const command = argv[0];
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    hasFlag(argv, "--help")
  ) {
    console.log(USAGE);
    return command && command !== "--help" && command !== "-h" ? 1 : 0;
  }

  const fixturesRoot = resolveBenchFixturesRoot();
  const store = new BenchStore(workspaceRoot);
  const live = new LiveRunFeed();

  try {
    if (command === "list") {
      const tasks = await loadBenchTasks(fixturesRoot);
      if (!tasks.length) {
        console.log("No bench tasks found.");
        return 0;
      }
      for (const t of tasks) {
        console.log(
          `${t.id.padEnd(22)} ${t.category.padEnd(10)} ${t.title}`,
        );
      }
      console.log(`\n${tasks.length} tasks in ${fixturesRoot}`);
      return 0;
    }

    if (command === "serve") {
      const port = parsePort(argv);
      const handle = await startBenchServer({
        store,
        live,
        port,
        workspaceRoot,
      });
      console.log(`bench dashboard → ${handle.url}`);
      console.log("Ctrl+C to stop.");
      await waitForInterrupt();
      await handle.close();
      return 0;
    }

    if (command === "run") {
      const offline = hasFlag(argv, "--offline");
      const parallel = parseParallel(argv, offline);
      const taskIds = parseTaskIds(argv);
      const wantServe = hasFlag(argv, "--serve");
      const port = parsePort(argv);

      const tasks = await loadBenchTasks(fixturesRoot, taskIds);
      if (!tasks.length) {
        console.error("No bench tasks to run.");
        return 1;
      }

      let handle: Awaited<ReturnType<typeof startBenchServer>> | undefined;
      if (wantServe) {
        handle = await startBenchServer({
          store,
          live,
          port,
          workspaceRoot,
        });
        console.log(`bench dashboard → ${handle.url}`);
      }

      console.log(
        `Running ${tasks.length} task(s)` +
          (offline ? " offline" : "") +
          ` parallel=${parallel}` +
          `…`,
      );

      const record = await runBench({
        workspaceRoot,
        tasks,
        parallel,
        offline,
        onUpdate: (snap) => live.update(snap),
      });
      await store.appendRun({
        ...record,
        kind: offline ? "offline" : "clai",
      });
      printRunSummary(record);

      if (handle) {
        console.log(`Dashboard still live at ${handle.url} — Ctrl+C to stop.`);
        await waitForInterrupt();
        await handle.close();
      }
      return 0;
    }

    console.error(`Unknown bench command: ${command}\n`);
    console.error(USAGE);
    return 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
