import assert from "node:assert/strict";
import { safeRun } from "./safe.mjs";

(async () => {
  try {
    const ok = await safeRun(async () => 1);
    const bad = await safeRun(async () => { throw new Error("x"); });
    assert.equal(ok.ok, true);
    assert.equal(bad.ok, false);
    console.log("PASS add-error-boundary-wrapper");
  } catch (err) {
    console.error("FAIL add-error-boundary-wrapper:", err.message);
    process.exit(1);
  }
})();
