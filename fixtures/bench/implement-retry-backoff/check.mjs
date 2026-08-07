import assert from "node:assert/strict";
import { retry } from "./retry.mjs";

(async () => {
  try {
    let n = 0;
    const val = await retry(async () => {
    n++;
    if (n < 3) throw new Error("fail");
    return 42;
    }, { retries: 5, baseMs: 1 });
    assert.equal(val, 42);
    assert.equal(n, 3);
    console.log("PASS implement-retry-backoff");
  } catch (err) {
    console.error("FAIL implement-retry-backoff:", err.message);
    process.exit(1);
  }
})();
