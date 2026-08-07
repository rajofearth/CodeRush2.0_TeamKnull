import assert from "node:assert/strict";
import { deepMerge } from "./merge-deep.mjs";

(async () => {
  try {
    const a = { x: { y: 1 }, z: 1 };
    const b = { x: { w: 2 }, z: 2 };
    const m = deepMerge(a, b);
    assert.deepEqual(m, { x: { y: 1, w: 2 }, z: 2 });
    assert.deepEqual(a, { x: { y: 1 }, z: 1 });
    console.log("PASS fix-deep-merge-mutation");
  } catch (err) {
    console.error("FAIL fix-deep-merge-mutation:", err.message);
    process.exit(1);
  }
})();
