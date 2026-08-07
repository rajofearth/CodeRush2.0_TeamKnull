import assert from "node:assert/strict";
import { validateOrder } from "./order.mjs";
import { validateCart } from "./cart.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

(async () => {
  try {
    assert.equal(validateOrder(2), 2);
    assert.equal(validateCart(3), 3);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const orderSrc = readFileSync(path.join(here, "order.mjs"), "utf8");
    const cartSrc = readFileSync(path.join(here, "cart.mjs"), "utf8");
    assert.ok(!orderSrc.includes("function isPositiveInt"));
    assert.ok(!cartSrc.includes("function isPositiveInt"));
    console.log("PASS refactor-extract-validator");
  } catch (err) {
    console.error("FAIL refactor-extract-validator:", err.message);
    process.exit(1);
  }
})();
