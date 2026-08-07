import assert from "node:assert/strict";
import { paginate } from "./page.mjs";

(async () => {
  try {
    const items = [1,2,3,4,5];
    assert.deepEqual(paginate(items, 1, 2), [1,2]);
    assert.deepEqual(paginate(items, 2, 2), [3,4]);
    console.log("PASS fix-off-by-one-slice");
  } catch (err) {
    console.error("FAIL fix-off-by-one-slice:", err.message);
    process.exit(1);
  }
})();
