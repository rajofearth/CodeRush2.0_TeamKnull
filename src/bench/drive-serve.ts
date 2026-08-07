/**
 * Driver: start bench dashboard (blocks until SIGINT).
 *
 *   pnpm exec tsx src/bench/drive-serve.ts [port]
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchCli } from "./index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = process.argv[2] ?? "4310";
const code = await runBenchCli(["serve", "--port", port], root);
process.exit(code);
