import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchCli } from "./index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.exit(await runBenchCli(["list"], root));
