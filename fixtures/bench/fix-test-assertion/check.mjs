import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatPrice } from "./price.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  // Guard: implementation must still match SPEC.md (agent must not "fix" the
  // impl to satisfy the stale test).
  assert.equal(formatPrice(2.5), "$2.50", "price.mjs must match SPEC.md");
  assert.equal(formatPrice(10), "$10.00", "price.mjs must match SPEC.md");
  assert.equal(formatPrice(0), "$0.00", "price.mjs must match SPEC.md");

  // The test file must now pass.
  execFileSync(process.execPath, ["price.test.mjs"], { cwd: here, stdio: "pipe" });
  console.log("PASS fix-test-assertion");
} catch (err) {
  console.error("FAIL fix-test-assertion:", err.message);
  process.exit(1);
}
