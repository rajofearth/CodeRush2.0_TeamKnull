import assert from "node:assert/strict";
import { parseQuantity } from "./parse-quantity.mjs";

const mustThrow = (value, label) => {
  assert.throws(() => parseQuantity(value), `parseQuantity(${label}) must throw`);
};

try {
  assert.equal(parseQuantity(5), 5);
  assert.equal(parseQuantity("12"), 12);
  assert.equal(parseQuantity(1), 1);

  mustThrow("abc", '"abc"');
  mustThrow(-1, "-1");
  mustThrow(0, "0");
  mustThrow(2.5, "2.5");
  mustThrow("", '""');
  mustThrow(null, "null");
  mustThrow(undefined, "undefined");
  mustThrow(true, "true");
  console.log("PASS validate-quantity");
} catch (err) {
  console.error("FAIL validate-quantity:", err.message);
  process.exit(1);
}
