import assert from "node:assert/strict";
import { sumRange, mean } from "./stats.mjs";

try {
  assert.equal(sumRange(1, 5), 15, "sumRange(1, 5) must be 15 (inclusive)");
  assert.equal(sumRange(3, 3), 3, "sumRange(3, 3) must be 3");
  assert.equal(sumRange(-2, 2), 0, "sumRange(-2, 2) must be 0");
  assert.equal(sumRange(10, 12), 33, "sumRange(10, 12) must be 33");
  assert.equal(mean([2, 4, 6]), 4, "mean must be untouched");
  console.log("PASS off-by-one");
} catch (err) {
  console.error("FAIL off-by-one:", err.message);
  process.exit(1);
}
