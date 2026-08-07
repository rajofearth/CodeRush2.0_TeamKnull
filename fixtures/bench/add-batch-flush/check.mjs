import assert from "node:assert/strict";
import { BatchBuffer } from "./batch.mjs";

(async () => {
  try {
    const batches = [];
    const bb = new BatchBuffer(2, (b) => batches.push(b));
    bb.push(1); bb.push(2); bb.push(3);
    assert.deepEqual(batches, [[1, 2]]);
    bb.flush();
    assert.deepEqual(batches[1], [3]);
    console.log("PASS add-batch-flush");
  } catch (err) {
    console.error("FAIL add-batch-flush:", err.message);
    process.exit(1);
  }
})();
