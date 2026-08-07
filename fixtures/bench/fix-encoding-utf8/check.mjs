import assert from "node:assert/strict";
import { sameText } from "./text.mjs";

(async () => {
  try {
    const a = "caf\u00e9";
    const b = "cafe\u0301";
    assert.equal(a === b, false);
    assert.equal(sameText(a, b), true);
    console.log("PASS fix-encoding-utf8");
  } catch (err) {
    console.error("FAIL fix-encoding-utf8:", err.message);
    process.exit(1);
  }
})();
