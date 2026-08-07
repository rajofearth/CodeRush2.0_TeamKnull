import assert from "node:assert/strict";
import { LRUCache } from "./lru.mjs";

(async () => {
  try {
    const lru = new LRUCache(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.get("a");
    lru.set("c", 3);
    assert.equal(lru.get("b"), undefined);
    assert.equal(lru.get("a"), 1);
    console.log("PASS implement-lru-cache");
  } catch (err) {
    console.error("FAIL implement-lru-cache:", err.message);
    process.exit(1);
  }
})();
