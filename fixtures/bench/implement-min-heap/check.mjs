import assert from "node:assert/strict";
import { MinHeap } from "./heap.mjs";

(async () => {
  try {
    const h = new MinHeap();
    h.push(3);
    h.push(1);
    h.push(2);
    assert.equal(h.pop(), 1);
    assert.equal(h.pop(), 2);
    assert.equal(h.pop(), 3);
    console.log("PASS implement-min-heap");
  } catch (err) {
    console.error("FAIL implement-min-heap:", err.message);
    process.exit(1);
  }
})();
