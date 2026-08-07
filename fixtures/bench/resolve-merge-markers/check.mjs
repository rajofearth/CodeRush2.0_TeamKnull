import assert from "node:assert/strict";
import { resolveConflict } from "./merge.mjs";

(async () => {
  try {
    const input = "a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\nb";
    assert.equal(resolveConflict(input), "a\ntheirs\nb");
    console.log("PASS resolve-merge-markers");
  } catch (err) {
    console.error("FAIL resolve-merge-markers:", err.message);
    process.exit(1);
  }
})();
