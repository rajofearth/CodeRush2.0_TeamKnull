import assert from "node:assert/strict";
import { ttlMemo } from "./memo.mjs";

(async () => {
  try {
    let calls = 0;
    const fn = ttlMemo((k) => { calls++; return k.length; }, 50);
    assert.equal(fn("abc"), 3);
    assert.equal(fn("abc"), 3);
    assert.equal(calls, 1);
    await new Promise((r) => setTimeout(r, 55));
    assert.equal(fn("abc"), 3);
    assert.equal(calls, 2);
    console.log("PASS add-cache-with-ttl");
  } catch (err) {
    console.error("FAIL add-cache-with-ttl:", err.message);
    process.exit(1);
  }
})();
