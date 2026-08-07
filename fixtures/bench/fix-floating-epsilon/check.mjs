import assert from "node:assert/strict";
import { nearEqual } from "./float.mjs";

(async () => {
  try {
    assert.equal(nearEqual(0.1 + 0.2, 0.3, 1e-9), true);
    assert.equal(nearEqual(1, 2), false);
    console.log("PASS fix-floating-epsilon");
  } catch (err) {
    console.error("FAIL fix-floating-epsilon:", err.message);
    process.exit(1);
  }
})();
