import assert from "node:assert/strict";
import { mapLimit } from "./pool.mjs";

(async () => {
  try {
    let running = 0;
    let max = 0;
    await mapLimit([1,2,3,4], 2, async () => {
    running++;
    max = Math.max(max, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    });
    assert.ok(max <= 2);
    console.log("PASS fix-async-map-unbounded");
  } catch (err) {
    console.error("FAIL fix-async-map-unbounded:", err.message);
    process.exit(1);
  }
})();
