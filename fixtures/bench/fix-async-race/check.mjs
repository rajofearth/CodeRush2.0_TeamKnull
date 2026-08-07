import assert from "node:assert/strict";
import { Inventory } from "./inventory.mjs";

try {
  // Concurrent reserves must not lose an update.
  const inv = new Inventory(10);
  await Promise.all([inv.reserve(3), inv.reserve(4)]);
  assert.equal(inv.stock, 3, `after reserving 3 and 4 from 10, stock must be 3 (got ${inv.stock})`);

  // Sequential behavior unchanged.
  const seq = new Inventory(10);
  assert.equal(await seq.reserve(3), 7);
  assert.equal(await seq.reserve(4), 3);

  // Insufficient stock still rejects.
  const small = new Inventory(2);
  await assert.rejects(() => small.reserve(5), /insufficient/i);
  assert.equal(small.stock, 2, "failed reserve must not change stock");

  // A rejection must not wedge later reserves.
  assert.equal(await small.reserve(1), 1);

  console.log("PASS fix-async-race");
} catch (err) {
  console.error("FAIL fix-async-race:", err.message);
  process.exit(1);
}
