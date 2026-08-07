import assert from "node:assert/strict";
import { aValue } from "./a.mjs";
import { bValue } from "./b.mjs";

(async () => {
  try {
    assert.equal(aValue(), "a:ok");
    assert.equal(bValue(), "b:ok");
    console.log("PASS fix-circular-import");
  } catch (err) {
    console.error("FAIL fix-circular-import:", err.message);
    process.exit(1);
  }
})();
