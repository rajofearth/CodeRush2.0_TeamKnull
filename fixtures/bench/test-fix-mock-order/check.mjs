import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

(async () => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    execFileSync(process.execPath, ["logger.test.mjs"], { cwd: here, stdio: "pipe" });
    console.log("PASS test-fix-mock-order");
  } catch (err) {
    console.error("FAIL test-fix-mock-order:", err.message);
    process.exit(1);
  }
})();
