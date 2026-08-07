import assert from "node:assert/strict";
import { applyPatch } from "./patch.mjs";

(async () => {
  try {
    const orig = "a\nb\nc";
    const patched = applyPatch(orig, " a\n-b\n+b2\n c");
    assert.equal(patched, "a\nb2\nc");
    console.log("PASS implement-apply-patch");
  } catch (err) {
    console.error("FAIL implement-apply-patch:", err.message);
    process.exit(1);
  }
})();
