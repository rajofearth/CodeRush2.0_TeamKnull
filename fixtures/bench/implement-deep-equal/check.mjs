import assert from "node:assert/strict";
import { deepEqual } from "./equal.mjs";

(async () => {
  try {
    assert.equal(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
    assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
    console.log("PASS implement-deep-equal");
  } catch (err) {
    console.error("FAIL implement-deep-equal:", err.message);
    process.exit(1);
  }
})();
