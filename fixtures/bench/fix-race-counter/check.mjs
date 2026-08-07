import assert from "node:assert/strict";
import { AsyncCounter } from "./counter.mjs";

(async () => {
  try {
    const c = new AsyncCounter();
    await Promise.all([c.increment(), c.increment(), c.increment()]);
    assert.equal(c.value, 3);
    console.log("PASS fix-race-counter");
  } catch (err) {
    console.error("FAIL fix-race-counter:", err.message);
    process.exit(1);
  }
})();
