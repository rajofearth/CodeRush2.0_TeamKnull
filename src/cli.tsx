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
  clai demo injection [--data-dir <path>]
  clai memory list|get|set|delete|export
  clai --fixture <path>
  clai run "<prompt>" [--cwd <path>]

Options:
  -h, --help              Show this help message
  demo                    Offline edit+bash happy path (no API key)
  --fixture <path>        Fixture workspace (default: fixtures/tiny-edit)
  run "<prompt>"          Soft agent loop via AI SDK (needs API key)
  --cwd <path>            Working directory for run (default: cwd)

Env:
  CEREBRAS_API_KEY                  Default provider (CLAI_PROVIDER=cerebras)
  OPENAI_API_KEY / ANTHROPIC_API_KEY  Alternate providers
  CLAI_PROVIDER                     cerebras | openai | anthropic
  CLAI_MODEL                        Model id override
  CLAI_AUTO_APPROVE=1               Auto-approve gated bash (dev only)
  CLAI_NO_TUI=1                     Headless activity (CI / pipes)

Quick start:
  pnpm install
  cp .env.example .env   # add keys
  pnpm clai --help
  pnpm clai demo
  pnpm clai run "edit hello.txt" --cwd fixtures/tiny-edit
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

const wantsHelp = args.includes("--help") || args.includes("-h");
const wantsMemory = args[0] === "memory";
const wantsInjectionDemo = args[0] === "demo" && args[1] === "injection";
const wantsDemo = (args.includes("demo") && !wantsInjectionDemo) || args.includes("--fixture");
const wantsRun = args[0] === "run";

if (wantsHelp || (!wantsDemo && !wantsRun && !wantsMemory && !wantsInjectionDemo && args.length === 0)) {
  console.log(HELP);
  process.exitCode = 0;
} else if (wantsMemory) {
  const { runMemoryCli } = await import("./memory/cli.js");
  await runMemoryCli(args.slice(1));
} else if (wantsInjectionDemo) {
  const { runInjectionDemo } = await import("./demo/injection.js");
  await runInjectionDemo(root, flagValue("--data-dir"));
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
  const prompt = args[1];
  if (!prompt) {
    console.error('Usage: clai run "<prompt>"');
    process.exitCode = 1;
  } else {
    const cwd = path.resolve(flagValue("--cwd") ?? process.cwd());
    const { hasApiKey, runAgentLoop, resolveModel } = await import(
      "./adapter/index.js"
    );
    const { createSandbox } = await import("./sandbox/index.js");
    const { createTraceWriter } = await import("./trace/index.js");
    const ui = await import("./ui/index.js");

    if (!hasApiKey()) {
      console.error(
        "No API key. Set OPENAI_API_KEY or ANTHROPIC_API_KEY, or use `clai demo`.",
      );
      process.exitCode = 1;
    } else {
      const sandbox = await createSandbox({
        workspaceRoot: cwd,
        autoApprove: process.env.CLAI_AUTO_APPROVE === "1",
      });
      const trace = await createTraceWriter({ cwd });
      const bus = ui.createUiBus();

      let shell: import("./ui/index.js").ShellHandle | null = null;
      let interrupted = false;
      if (ui.isTuiEnabled()) {
        shell = await ui.renderShell({
          bus,
          context: { title: prompt, agent: "build", cwd, runId: trace.runId },
          onInterrupt: () => {
            interrupted = true;
            bus.emit({
              type: "status",
              label: "interrupt requested",
              level: "warn",
              sticky: true,
            });
          },
        });
      } else {
        ui.attachHeadless(bus);
      }

      bus.emit({
        type: "context",
        title: prompt,
        cwd,
        runId: trace.runId,
        sandboxMode: sandbox.mode,
        tracePath: trace.path,
      });
      bus.emit({ type: "user", text: prompt });

      const ctx = {
        workspaceRoot: cwd,
        sandbox,
        trace,
        onEvent: ui.createToolPlaneBridge(bus),
      };

      try {
        const model = await resolveModel();
        bus.emit({
          type: "context",
          model: `${model.provider}/${model.modelId}`,
        });
        bus.emit({ type: "status", label: "thinking" });

        let turn = 0;
        const result = await runAgentLoop({
          ctx,
          prompt,
          trace,
          model,
          onText: (text) => {
            turn += 1;
            bus.emit({ type: "assistant", id: `turn-${turn}`, text, done: true });
            bus.emit({ type: "status", label: "thinking" });
          },
          onUsage: (usage) =>
            bus.emit({
              type: "metrics",
              tokensIn: usage.promptTokens,
              tokensOut: usage.completionTokens,
            }),
        });
        await trace.close("ok", {
          finishReason: result.finishReason,
          steps: result.steps,
        });
        bus.emit({
          type: "status",
          label: interrupted ? "interrupted" : "done",
          detail: `${result.finishReason} · ${result.steps} steps`,
          sticky: true,
          done: true,
        });
        shell?.done(0);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await trace.append("error", { message: msg });
        await trace.close("fail");
        bus.emit({
          type: "status",
          label: "error",
          detail: msg,
          level: "error",
          sticky: true,
          done: true,
        });
        shell?.done(1);
        process.exitCode = 1;
      } finally {
        await sandbox.dispose();
        await shell?.waitUntilExit();
      }
    }
  }
} else {
  console.log(HELP);
  process.exitCode = 0;
}
