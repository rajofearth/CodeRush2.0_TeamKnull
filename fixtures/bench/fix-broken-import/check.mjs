import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  const out = execFileSync(process.execPath, ["main.mjs"], {
    cwd: here,
    stdio: "pipe",
  }).toString();
  assert.ok(out.includes("clamp(15, 0, 10) = 10"), `unexpected output: ${out.trim()}`);
  assert.ok(out.includes("clamp(-3, 0, 10) = 0"), `unexpected output: ${out.trim()}`);
  console.log("PASS fix-broken-import");
} catch (err) {
  console.error("FAIL fix-broken-import:", err.stderr?.toString().split("\n")[0] || err.message);
  process.exit(1);
}
