import assert from "node:assert/strict";
import { formatPrice } from "./price.mjs";

assert.equal(formatPrice(2.5), "$2.5");
assert.equal(formatPrice(10), "$10.00");
assert.equal(formatPrice(0), "$0.00");
console.log("price tests passed");
