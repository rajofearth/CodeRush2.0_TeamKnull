/**
 * CLAI CLI — help stays light; demo / agent paths lazy-import heavy seams.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./adapter/env.js";
import { isTuiEnabled } from "./ui/headless.js";
import {
  openWorkspaceFromEntry,
  parseEntry,
  printWorkspaceNotes,
  WorkspaceError,
} from "./workspace.js";

await loadEnvFiles();

const HELP = `
clai — Unified Agentic Coding Harness

Usage:
  clai [<folder>] [--cwd <path>]
  clai --help
  clai demo [--fixture <path>]
  clai demo lsp [--fixture <path>]
  clai demo injection [--data-dir <path>]
  clai intake [--cwd <path>]
  clai memory list|get|set|delete|export
  clai bench run|serve|list [--offline] [--parallel N] [--serve]
  clai --fixture <path>
  clai run "<prompt>" [--cwd <path>]

Options:
  -h, --help              Show this help message
  <folder>                Workspace root for the session (default: cwd)
  demo                    Offline edit+bash happy path (no API key)
  demo lsp                Offline intake + LSP diagnostics demo
  intake                  Print repository intake map (JSON)
  --fixture <path>        Fixture workspace (default: fixtures/tiny-edit)
  run "<prompt>"          Soft agent loop via AI SDK (needs API key)
  bench run               Parallel task subset (use --offline with no API key)
  bench serve             Live metrics dashboard over history (port 4310)
  --cwd <path>            Workspace root; overrides a positional <folder>
  --                      Everything after it is a path, never a subcommand

Workspace root:
  A bare first word matching run/demo/intake/memory/bench/help is a subcommand;
  anything else is the workspace folder. Use "clai -- demo" or
  "clai --cwd demo" to open a folder that shares a subcommand name.
  The resolved root governs tool cwd, .clai/traces, .clai memory, and intake.

Env:
  GROQ_API_KEY                      Default provider (CLAI_PROVIDER=groq)
  OPENROUTER_API_KEY / CEREBRAS_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
  GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY
  CLAI_PROVIDER                     groq | openrouter | cerebras | openai | anthropic | gemini
  CLAI_MODEL                        Model id (default openai/gpt-oss-20b; gemini → gemini-3.5-flash-lite)
  CLAI_AUTO_APPROVE=1               Auto-approve gated bash (dev only)
  CLAI_NO_TUI=1                     Headless activity (CI / pipes)
  CLAI_LSP_PY                       Optional Python language-server binary

Quick start:
  pnpm install
  cp .env.example .env   # add GROQ_API_KEY
  pnpm clai --help
  pnpm clai demo
  CLAI_NO_TUI=1 pnpm clai demo lsp
  pnpm clai intake --cwd fixtures/lsp-ts
  pnpm clai fixtures/tiny-edit
  pnpm clai bench run --offline --serve
  pnpm clai run --cwd fixtures/tiny-edit
  pnpm clai run "what's in the codebase" --cwd fixtures/tiny-edit
`.trim();

const entry = parseEntry(process.argv.slice(2));
const args = entry.args;

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("-")) {
    return args[i + 1];
  }
  const eq = args.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultFixture = path.join(root, "fixtures", "tiny-edit");
const defaultLspFixture = path.join(root, "fixtures", "lsp-ts");

const wantsHelp =
  args.includes("--help") || args.includes("-h") || entry.subcommand === "help";
const wantsMemory = entry.subcommand === "memory";
const wantsIntake = entry.subcommand === "intake";
const wantsInjectionDemo = entry.subcommand === "demo" && args[1] === "injection";
const wantsLspDemo = entry.subcommand === "demo" && args[1] === "lsp";
const wantsDemo =
  (entry.subcommand === "demo" && !wantsInjectionDemo && !wantsLspDemo) ||
  (args.includes("--fixture") && !wantsLspDemo && entry.subcommand !== "demo");
const wantsRun = entry.subcommand === "run";
const wantsBench = entry.subcommand === "bench";
/** Bare `clai` / `clai <folder>` — launch the interface on the resolved root. */
const wantsLaunch =
  !wantsHelp &&
  !wantsMemory &&
  !wantsIntake &&
  !wantsInjectionDemo &&
  !wantsLspDemo &&
  !wantsDemo &&
  !wantsRun &&
  !wantsBench;

async function resolveWorkspace(showNotes = true) {
  try {
    const workspace = await openWorkspaceFromEntry(entry, flagValue("--cwd"));
    if (showNotes) printWorkspaceNotes(workspace);
    return workspace;
  } catch (error) {
    if (error instanceof WorkspaceError) {
      console.error(error.message);
      console.error(`  ${error.hint}`);
      process.exit(1);
    }
    throw error;
  }
}

if (wantsHelp) {
  console.log(HELP);
  process.exitCode = 0;
} else if (wantsMemory) {
  const workspace = await resolveWorkspace(false);
  const { runMemoryCli } = await import("./memory/cli.js");
  await runMemoryCli(args.slice(1), workspace.dataDir);
} else if (wantsBench) {
  const workspace = await resolveWorkspace(false);
  const { runBenchCli } = await import("./bench/index.js");
  process.exitCode = await runBenchCli(args.slice(1), workspace.root);
} else if (wantsIntake) {
  const workspace = await resolveWorkspace();
  const { scanIntakeMap } = await import("./tools/intake.js");
  const map = await scanIntakeMap(workspace.root);
  console.log(JSON.stringify(map, null, 2));
  process.exitCode = 0;
} else if (wantsInjectionDemo) {
  const { runInjectionDemo } = await import("./demo/injection.js");
  await runInjectionDemo(root, flagValue("--data-dir"));
} else if (wantsLspDemo) {
  const fixture = path.resolve(flagValue("--fixture") ?? defaultLspFixture);
  const { runLspDemo } = await import("./demo/lsp.js");
  const ui = await import("./ui/index.js");
  const bus = ui.createUiBus();

  if (!ui.isTuiEnabled()) {
    ui.attachHeadless(bus);
    const result = await runLspDemo({
      fixtureDir: fixture,
      bus,
      autoApprove: true,
    });
    console.log(
      JSON.stringify({
        ok: result.ok,
        runId: result.runId,
        sandboxMode: result.sandboxMode,
        stubReason: result.stubReason,
        tracePath: result.tracePath,
        intakeLanguages: result.intakeLanguages,
        diagnosticsBefore: result.diagnosticsBefore,
        diagnosticsAfter: result.diagnosticsAfter,
        checkExitCode: result.checkExitCode,
        lsp: result.lsp,
      }),
    );
    process.exitCode = result.ok ? 0 : 1;
  } else {
    const shell = await ui.renderShell({
      bus,
      context: { title: "LSP + intake demo", agent: "demo", cwd: fixture },
    });
    const result = await runLspDemo({
      fixtureDir: fixture,
      bus,
      autoApprove: true,
    });
    shell.done(result.ok ? 0 : 1);
    await shell.waitUntilExit();
  }
} else if (wantsDemo) {
  const fixture = path.resolve(flagValue("--fixture") ?? defaultFixture);
  const { writeFile } = await import("node:fs/promises");
  const { runOfflineDemo } = await import("./demo/offline.js");
  const ui = await import("./ui/index.js");

  await writeFile(path.join(fixture, "hello.txt"), "Hello, world!\n", "utf8");

  const bus = ui.createUiBus();

  if (!ui.isTuiEnabled()) {
    ui.attachHeadless(bus);
    const result = await runOfflineDemo({
      fixtureDir: fixture,
      bus,
      autoApprove: true,
    });
    console.log(
      JSON.stringify({
        ok: result.ok,
        runId: result.runId,
        sandboxMode: result.sandboxMode,
        stubReason: result.stubReason,
        tracePath: result.tracePath,
        checkExitCode: result.checkExitCode,
      }),
    );
    process.exitCode = result.ok ? 0 : 1;
  } else {
    const shell = await ui.renderShell({
      bus,
      context: { title: "offline demo", agent: "demo", cwd: fixture },
    });
    const result = await runOfflineDemo({
      fixtureDir: fixture,
      bus,
      autoApprove: true,
    });
    shell.done(result.ok ? 0 : 1);
    await shell.waitUntilExit();
  }
} else if (wantsRun || wantsLaunch) {
  const initialPrompt = wantsRun ? args[1] : undefined; // optional when TTY interactive
  const workspace = await resolveWorkspace();
  const cwd = workspace.root;

  if (wantsLaunch && !isTuiEnabled()) {
    // No interactive surface to launch: report the resolved contract instead.
    console.log(
      JSON.stringify(
        {
          root: workspace.root,
          rootSource: workspace.source,
          dataDir: workspace.dataDir,
          tracesDir: workspace.tracesDir,
          gitRepo: workspace.isGitRepo,
          tui: false,
          hint: 'headless has no interactive input — use clai run "<prompt>" here',
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const { hasApiKey, runAgentLoop, resolveModel } = await import(
    "./adapter/index.js"
  );
  const { createSandbox } = await import("./sandbox/index.js");
  const { createTraceWriter } = await import("./trace/index.js");
  const { intakeTool, probeLspAvailability } = await import("./tools/index.js");
  const ui = await import("./ui/index.js");
  type CoreMessage = import("ai").CoreMessage;

  if (!hasApiKey()) {
    console.error(
      "No API key. Set GROQ_API_KEY (default), or OPENROUTER/CEREBRAS/OPENAI/ANTHROPIC/GEMINI — or use `clai demo`.",
    );
    process.exitCode = 1;
  } else if (!ui.isTuiEnabled() && !initialPrompt) {
    console.error(
      'Headless mode needs a prompt: clai run "<prompt>" (or unset CLAI_NO_TUI for interactive).',
    );
    process.exitCode = 1;
  } else {
    const sandbox = await createSandbox({
      workspaceRoot: cwd,
      autoApprove: process.env.CLAI_AUTO_APPROVE === "1",
    });
    const trace = await createTraceWriter({
      cwd,
      tracesDir: workspace.tracesDir,
    });
    const bus = ui.createUiBus();
    const lsp = await probeLspAvailability(cwd);
    const lspNames = lsp.filter((s) => s.available).map((s) => s.engine);
    let history: CoreMessage[] = [];
    let turn = 0;
    let running = false;
    let interrupted = false;
    let intakeSeed = "";
    let lastTurnFailed = false;

    const model = await resolveModel();

    const ctx = {
      workspaceRoot: cwd,
      sandbox,
      trace,
      onEvent: ui.createToolPlaneBridge(bus),
    };

    async function ensureIntake(): Promise<void> {
      if (intakeSeed) return;
      bus.emit({ type: "status", label: "intake scan" });
      const intake = await intakeTool(ctx, {});
      if (intake.ok && intake.map && typeof intake.map === "object") {
        const map = intake.map as { summary?: string };
        // Product one-liner only — never the bounded "run pnpm test" issue seed.
        intakeSeed = map.summary ? `Project: ${map.summary}.` : "";
      } else {
        intakeSeed = "";
      }
      bus.emit({ type: "status", label: "ready", done: true });
    }

    async function runTurn(prompt: string): Promise<void> {
      if (running) return;
      running = true;
      interrupted = false;
      lastTurnFailed = false;
      bus.emit({ type: "user", text: prompt });
      bus.emit({ type: "context", title: prompt.slice(0, 80) });
      bus.emit({ type: "status", label: "thinking" });

      try {
        await ensureIntake();
        const result = await runAgentLoop({
          ctx,
          prompt,
          history,
          system: intakeSeed
            ? `Repository intake notes:\n${intakeSeed}`
            : undefined,
          trace,
          model,
          onStatus: (status) =>
            bus.emit({
              type: "status",
              label: status.label,
              detail: status.detail,
              level: status.level,
              done: status.done,
              sticky: status.sticky,
            }),
          onText: (text) => {
            turn += 1;
            bus.emit({
              type: "assistant",
              id: `turn-${turn}`,
              text,
              done: true,
            });
          },
          onUsage: (usage) =>
            bus.emit({
              type: "metrics",
              tokensIn: usage.promptTokens,
              tokensOut: usage.completionTokens,
            }),
        });
        history = result.messages;
        bus.emit({
          type: "status",
          label: interrupted ? "interrupted" : "ready",
          detail: `${result.finishReason} · ${result.steps} steps`,
          sticky: true,
          done: true,
        });
      } catch (err) {
        lastTurnFailed = true;
        const msg = err instanceof Error ? err.message : String(err);
        await trace.append("error", { message: msg });
        bus.emit({
          type: "status",
          label: "error",
          detail: msg,
          level: "error",
          sticky: true,
          done: true,
        });
      } finally {
        running = false;
      }
    }

    if (ui.isTuiEnabled()) {
      const shell = await ui.renderShell({
        bus,
        interactive: true,
        exitWhenDone: false,
        context: {
          title: initialPrompt ?? "clai session",
          agent: "build",
          cwd,
          runId: trace.runId,
          model: `${model.provider}/${model.modelId}`,
          sandboxMode: sandbox.mode,
          tracePath: trace.path,
          lsp: lspNames,
        },
        onInterrupt: () => {
          interrupted = true;
          bus.emit({
            type: "status",
            label: "interrupt requested",
            level: "warn",
            sticky: true,
          });
        },
        onSubmit: (text) => {
          void runTurn(text);
        },
      });

      bus.emit({
        type: "context",
        cwd,
        runId: trace.runId,
        sandboxMode: sandbox.mode,
        model: `${model.provider}/${model.modelId}`,
        tracePath: trace.path,
        lsp: lspNames,
      });
      bus.emit({
        type: "status",
        label: "ready",
        detail: "type a message · pgup/pgdn scroll · ctrl+c quit",
        sticky: true,
        done: true,
      });

      if (initialPrompt) {
        await runTurn(initialPrompt);
      }

      await shell.waitUntilExit();
      await trace.close("ok");
      await sandbox.dispose();
    } else {
      ui.attachHeadless(bus);
      bus.emit({
        type: "context",
        title: initialPrompt!,
        cwd,
        runId: trace.runId,
        sandboxMode: sandbox.mode,
        model: `${model.provider}/${model.modelId}`,
        tracePath: trace.path,
        lsp: lspNames,
      });
      try {
        await runTurn(initialPrompt!);
        await trace.close(lastTurnFailed ? "fail" : "ok");
        process.exitCode = lastTurnFailed ? 1 : 0;
      } catch {
        await trace.close("fail");
        process.exitCode = 1;
      } finally {
        await sandbox.dispose();
      }
    }
  }
} else {
  console.log(HELP);
  process.exitCode = 0;
}
