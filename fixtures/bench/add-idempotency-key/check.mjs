import assert from "node:assert/strict";
import { IdempotencyStore } from "./idem.mjs";

(async () => {
  try {
    const store = new IdempotencyStore();
    let n = 0;
    const fn = async () => { n++; return "ok"; };
    assert.equal(await store.run("k", fn), "ok");
    assert.equal(await store.run("k", fn), "ok");
    assert.equal(n, 1);
    console.log("PASS add-idempotency-key");
  } catch (err) {
    console.error("FAIL add-idempotency-key:", err.message);
    process.exit(1);
  }
})();
