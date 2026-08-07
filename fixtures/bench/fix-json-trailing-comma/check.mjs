import assert from "node:assert/strict";
import { parseStrictJson } from "./json.mjs";

(async () => {
  try {
    assert.deepEqual(parseStrictJson('{"a":1}'), { a: 1 });
    assert.throws(() => parseStrictJson('{"a":1,}'));
    console.log("PASS fix-json-trailing-comma");
  } catch (err) {
    console.error("FAIL fix-json-trailing-comma:", err.message);
    process.exit(1);
  }
})();
