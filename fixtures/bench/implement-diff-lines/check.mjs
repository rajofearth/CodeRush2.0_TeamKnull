import assert from "node:assert/strict";
import { diffLines } from "./diff.mjs";

(async () => {
  try {
    const d = diffLines("a\nb\n", "b\nc\n");
    assert.deepEqual(d.removed, ["a"]);
    assert.deepEqual(d.added, ["c"]);
    console.log("PASS implement-diff-lines");
  } catch (err) {
    console.error("FAIL implement-diff-lines:", err.message);
    process.exit(1);
  }
})();
