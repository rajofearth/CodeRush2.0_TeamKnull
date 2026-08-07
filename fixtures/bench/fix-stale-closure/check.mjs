import assert from "node:assert/strict";
import { Counter } from "./delayed.mjs";

(async () => {
  try {
    const c = new Counter();
    const inc = c.makeDelayedIncrement(5);
    inc();
    c.count = 5;
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(c.count, 6);
    console.log("PASS fix-stale-closure");
  } catch (err) {
    console.error("FAIL fix-stale-closure:", err.message);
    process.exit(1);
  }
})();
