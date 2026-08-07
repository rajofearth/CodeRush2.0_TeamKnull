/**
 * Driver: run offline bench via runBenchCli (no API key).
 *
 *   pnpm exec tsx src/bench/drive-offline.ts
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchCli } from "./index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const code = await runBenchCli(["run", "--offline", "--parallel", "4"], root);
process.exit(code);
