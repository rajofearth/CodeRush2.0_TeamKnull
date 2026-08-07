import assert from "node:assert/strict";
import { equalUtf8 } from "./encoding.mjs";

(async () => {
  try {
    const a = "caf\u00e9";
    const b = "cafe\u0301";
    assert.equal(a === b, false);
    assert.equal(equalUtf8(a, b), true);
    console.log("PASS fix-buffer-encoding");
  } catch (err) {
    console.error("FAIL fix-buffer-encoding:", err.message);
    process.exit(1);
  }
})();
