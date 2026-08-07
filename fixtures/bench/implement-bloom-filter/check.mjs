import assert from "node:assert/strict";
import { BloomFilter } from "./bloom.mjs";

(async () => {
  try {
    const bf = new BloomFilter(256);
    bf.add("hello");
    assert.equal(bf.maybeHas("hello"), true);
    assert.equal(bf.maybeHas("missing"), false);
    console.log("PASS implement-bloom-filter");
  } catch (err) {
    console.error("FAIL implement-bloom-filter:", err.message);
    process.exit(1);
  }
})();
