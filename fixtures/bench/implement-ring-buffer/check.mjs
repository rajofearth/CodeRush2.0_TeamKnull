import assert from "node:assert/strict";
import { RingBuffer } from "./ring.mjs";

(async () => {
  try {
    const r = new RingBuffer(3);
    r.push(1); r.push(2); r.push(3); r.push(4);
    assert.deepEqual(r.toArray(), [2, 3, 4]);
    console.log("PASS implement-ring-buffer");
  } catch (err) {
    console.error("FAIL implement-ring-buffer:", err.message);
    process.exit(1);
  }
})();
