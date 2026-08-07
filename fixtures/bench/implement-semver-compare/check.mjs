import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  execFileSync(process.execPath, ["semver.test.mjs"], { cwd: here, stdio: "pipe" });
  console.log("PASS implement-semver-compare");
} catch (err) {
  console.error("FAIL implement-semver-compare:", err.stderr?.toString() || err.message);
  process.exit(1);
}
