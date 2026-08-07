/**
 * Combined catalog of scaffolded bench tasks.
 */

import { deepSweTasks } from "./deepswe.js";
import { terminalBenchTasks } from "./terminal-bench.js";
import type { CatalogTask } from "./types.js";
import { LEGACY_TASK_IDS } from "./types.js";

export type { CatalogTask, TaskSource } from "./types.js";
export { LEGACY_TASK_IDS } from "./types.js";

export function allCatalogTasks(): CatalogTask[] {
  const byId = new Map<string, CatalogTask>();
  for (const task of [...terminalBenchTasks, ...deepSweTasks]) {
    if (byId.has(task.id)) {
      throw new Error(`duplicate catalog task id: ${task.id}`);
    }
    byId.set(task.id, task);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function catalogTasksToScaffold(): CatalogTask[] {
  return allCatalogTasks().filter((t) => !LEGACY_TASK_IDS.has(t.id));
}

export function catalogStats(): {
  total: number;
  legacy: number;
  scaffold: number;
  byBenchmark: Record<string, number>;
} {
  const all = allCatalogTasks();
  const byBenchmark: Record<string, number> = {};
  for (const t of all) {
    byBenchmark[t.source.benchmark] = (byBenchmark[t.source.benchmark] ?? 0) + 1;
  }
  return {
    total: all.length + LEGACY_TASK_IDS.size,
    legacy: LEGACY_TASK_IDS.size,
    scaffold: all.length,
    byBenchmark,
  };
}
