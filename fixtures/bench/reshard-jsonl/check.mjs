import assert from "node:assert/strict";
import { reshard } from "./reshard.mjs";

(async () => {
  try {
    const lines = ["a","b","c","d","e"];
    const shards = reshard(lines, 2);
    assert.deepEqual(shards, [["a","c","e"], ["b","d"]]);
    console.log("PASS reshard-jsonl");
  } catch (err) {
    console.error("FAIL reshard-jsonl:", err.message);
    process.exit(1);
  }
})();
