import assert from "node:assert/strict";
import { stableSort } from "./sort.mjs";

(async () => {
  try {
    const items = [{ v: 1, id: "a" }, { v: 1, id: "b" }, { v: 0, id: "c" }];
    const sorted = stableSort(items, (x) => x.v);
    assert.deepEqual(sorted.map((x) => x.id), ["c", "a", "b"]);
    console.log("PASS implement-stable-sort");
  } catch (err) {
    console.error("FAIL implement-stable-sort:", err.message);
    process.exit(1);
  }
})();
