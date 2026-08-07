import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  execFileSync(process.execPath, ["config-loader.test.mjs"], { cwd: here, stdio: "pipe" });
  console.log("PASS add-config-file-parser");
} catch (err) {
  console.error("FAIL add-config-file-parser:", err.stderr?.toString() || err.message);
  process.exit(1);
}
