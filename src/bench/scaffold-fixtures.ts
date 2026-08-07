/**
 * Scaffold bench fixtures from the task catalog.
 *
 *   pnpm exec tsx src/bench/scaffold-fixtures.ts
 *   pnpm exec tsx src/bench/scaffold-fixtures.ts --force   # overwrite catalog tasks
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allCatalogTasks,
  catalogStats,
  catalogTasksToScaffold,
  LEGACY_TASK_IDS,
  type CatalogTask,
} from "./task-catalog/index.js";
import { resolveBenchFixturesRoot } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function writeTask(fixtureRoot: string, task: CatalogTask): Promise<void> {
  const dir = path.join(fixtureRoot, task.id);
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(dir, "_solution"), { recursive: true });

  const taskJson = {
    id: task.id,
    title: task.title,
    prompt: task.prompt.includes("check.mjs")
      ? task.prompt
      : `${task.prompt} Verify with \`node check.mjs\` (exit code 0 means done).`,
    category: task.category,
    timeoutMs: task.timeoutMs ?? 150_000,
    maxSteps: task.maxSteps ?? 12,
    source: task.source,
  };

  await writeFile(path.join(dir, "task.json"), `${JSON.stringify(taskJson, null, 2)}\n`, "utf8");
  await writeFile(path.join(dir, "check.mjs"), task.check, "utf8");

  for (const [rel, content] of Object.entries(task.files)) {
    const dest = path.join(dir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf8");
  }

  for (const [rel, content] of Object.entries(task.solution)) {
    const dest = path.join(dir, "_solution", rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf8");
  }
}

async function writeManifest(fixtureRoot: string): Promise<void> {
  const legacyIds = [...LEGACY_TASK_IDS].sort();
  const catalog = allCatalogTasks();
  const manifest = {
    version: 1,
    description:
      "CLAI bench manifest — 80 tasks: 8 legacy CLAI fixtures + 72 adapted from Terminal-Bench 2.1 and DeepSWE themes.",
    totalTasks: legacyIds.length + catalog.length,
    legacyTaskIds: legacyIds,
    tasks: [
      ...legacyIds.map((id) => ({
        id,
        source: { benchmark: "clai", taskId: id },
      })),
      ...catalog.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        source: t.source,
      })),
    ],
  };
  await writeFile(
    path.join(fixtureRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function main(): Promise<number> {
  const force = process.argv.includes("--force");
  const fixtureRoot = resolveBenchFixturesRoot();
  const tasks = catalogTasksToScaffold();
  const stats = catalogStats();

  console.log(
    `Scaffolding ${tasks.length} catalog tasks into ${fixtureRoot} (legacy ${stats.legacy} preserved)…\n`,
  );

  let written = 0;
  for (const task of tasks) {
    const dir = path.join(fixtureRoot, task.id);
    try {
      const { access } = await import("node:fs/promises");
      await access(path.join(dir, "task.json"));
      if (!force) {
        console.log(`  skip ${task.id} (exists)`);
        continue;
      }
    } catch {
      // new task
    }
    await writeTask(fixtureRoot, task);
    written++;
    console.log(`  write ${task.id}`);
  }

  await writeManifest(fixtureRoot);

  console.log(
    `\nDone. Wrote ${written} task(s). Catalog: ${stats.scaffold} scaffold + ${stats.legacy} legacy = ${stats.total} total.`,
  );
  console.log(`Manifest: ${path.join(fixtureRoot, "manifest.json")}`);
  return 0;
}

process.exit(await main());
