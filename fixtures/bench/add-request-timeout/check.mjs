import assert from "node:assert/strict";
import { withTimeout } from "./timeout.mjs";

(async () => {
  try {
    await assert.rejects(() => withTimeout(new Promise(() => {}), 20), /TimeoutError/);
    assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
    console.log("PASS add-request-timeout");
  } catch (err) {
    console.error("FAIL add-request-timeout:", err.message);
    process.exit(1);
  }
})();
