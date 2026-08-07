import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

(async () => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    execFileSync(process.execPath, ["timer.test.mjs"], { cwd: here, stdio: "pipe" });
    console.log("PASS test-fix-async-flaky");
  } catch (err) {
    console.error("FAIL test-fix-async-flaky:", err.message);
    process.exit(1);
  }
})();
