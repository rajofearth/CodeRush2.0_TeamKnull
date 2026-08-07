import assert from "node:assert/strict";
import { totalByKey } from "./totals.mjs";

(async () => {
  try {
    assert.deepEqual(totalByKey([{ key: "a", n: 1 }]), { a: 1 });
    assert.deepEqual(totalByKey([{ key: "b", n: 2 }]), { b: 2 });
    console.log("PASS fix-reducer-mutation");
  } catch (err) {
    console.error("FAIL fix-reducer-mutation:", err.message);
    process.exit(1);
  }
})();
