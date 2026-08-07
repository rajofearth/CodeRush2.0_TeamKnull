import assert from "node:assert/strict";
import { shouldRetry } from "./retry-http.mjs";

(async () => {
  try {
    assert.equal(shouldRetry(429), true);
    assert.equal(shouldRetry(503), true);
    assert.equal(shouldRetry(404), false);
    assert.equal(shouldRetry(200), false);
    console.log("PASS add-retry-transient-errors");
  } catch (err) {
    console.error("FAIL add-retry-transient-errors:", err.message);
    process.exit(1);
  }
})();
