import assert from "node:assert/strict";
import { JobQueue } from "./queue.mjs";

(async () => {
  try {
    const q = new JobQueue();
    const order = [];
    q.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 15));
    order.push(1);
    });
    q.enqueue(async () => {
    order.push(2);
    });
    await q.drain();
    assert.deepEqual(order, [1, 2]);
    console.log("PASS implement-queue-processor");
  } catch (err) {
    console.error("FAIL implement-queue-processor:", err.message);
    process.exit(1);
  }
})();
