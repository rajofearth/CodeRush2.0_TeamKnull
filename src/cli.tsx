/**
 * CLAI CLI — help stays light; demo / agent paths lazy-import heavy seams.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./adapter/env.js";

await loadEnvFiles();

const HELP = `
clai — Unified Agentic Coding Harness

Usage:
  clai --help
  clai demo [--fixture <path>]
  clai demo lsp [--fixture <path>]
  clai demo injection [--data-dir <path>]
  clai intake [--cwd <path>]
  clai memory list|get|set|delete|export
  clai --fixture <path>
  clai run "<prompt>" [--cwd <path>]

Options:
  -h, --help              Show this help message
  demo                    Offline edit+bash happy path (no API key)
  demo lsp                Offline intake + LSP diagnostics demo
  intake                  Print repository intake map (JSON)
  --fixture <path>        Fixture workspace (default: fixtures/tiny-edit)
  run "<prompt>"          Soft agent loop via AI SDK (needs API key)
  --cwd <path>            Working directory for run/intake (default: cwd)

Env:
  GROQ_API_KEY                      Default provider (CLAI_PROVIDER=groq)
  OPENROUTER_API_KEY / CEREBRAS_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
  CLAI_PROVIDER                     groq | openrouter | cerebras | openai | anthropic
  CLAI_MODEL                        Model id (default openai/gpt-oss-20b)
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
  pnpm clai run --cwd fixtures/tiny-edit
  pnpm clai run "what's in the codebase" --cwd fixtures/tiny-edit
`.trim();

const args = process.argv.slice(2);

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

const wantsHelp = args.includes("--help") || args.includes("-h");
const wantsMemory = args[0] === "memory";
const wantsIntake = args[0] === "intake";
const wantsInjectionDemo = args[0] === "demo" && args[1] === "injection";
const wantsLspDemo = args[0] === "demo" && args[1] === "lsp";
const wantsDemo =
  (args.includes("demo") && !wantsInjectionDemo && !wantsLspDemo) ||
  (args.includes("--fixture") && !wantsLspDemo && args[0] !== "demo");
const wantsRun = args[0] === "run";

if (
  wantsHelp ||
  (!wantsDemo &&
    !wantsRun &&
    !wantsMemory &&
    !wantsInjectionDemo &&
    !wantsLspDemo &&
    !wantsIntake &&
    args.length === 0)
) {
  console.log(HELP);
  process.exitCode = 0;
} else if (wantsMemory) {
  const { runMemoryCli } = await import("./memory/cli.js");
  await runMemoryCli(args.slice(1));
} else if (wantsIntake) {
  const cwd = path.resolve(flagValue("--cwd") ?? process.cwd());
  const { scanIntakeMap } = await import("./tools/intake.js");
  const map = await scanIntakeMap(cwd);
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
} else if (wantsRun) {
  const initialPrompt = args[1]; // optional when TTY interactive
  const cwd = path.resolve(flagValue("--cwd") ?? process.cwd());
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
      "No API key. Set GROQ_API_KEY (default), or OPENROUTER/CEREBRAS/OPENAI/ANTHROPIC — or use `clai demo`.",
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
    const trace = await createTraceWriter({ cwd });
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
      intakeSeed =
        intake.ok && intake.map && typeof intake.map === "object"
          ? String((intake.map as { issuePrompt?: string }).issuePrompt ?? "")
          : "";
      if (intakeSeed) {
        bus.emit({
          type: "assistant",
          id: "intake-seed",
          text: intakeSeed,
          done: true,
        });
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
            ? `Repository intake notes:\n${intakeSeed}\n\nUse tools to explore.`
            : undefined,
          trace,
          model,
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
