import assert from "node:assert/strict";
import { getPath } from "./path-get.mjs";

(async () => {
  try {
    assert.equal(getPath({ a: { b: 1 } }, ["a", "b"]), 1);
    assert.equal(getPath({ a: {} }, ["a", "b", "c"]), undefined);
    console.log("PASS fix-null-deref-chain");
  } catch (err) {
    console.error("FAIL fix-null-deref-chain:", err.message);
    process.exit(1);
  }
})();
