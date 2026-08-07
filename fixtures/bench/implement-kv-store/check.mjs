import assert from "node:assert/strict";
import { KVStore } from "./kv.mjs";

(async () => {
  try {
    const kv = new KVStore();
    kv.set("a", 1);
    assert.equal(kv.get("a"), 1);
    kv.set("b", 2, 30);
    assert.equal(kv.get("b"), 2);
    kv.delete("a");
    assert.equal(kv.get("a"), undefined);
    console.log("PASS implement-kv-store");
  } catch (err) {
    console.error("FAIL implement-kv-store:", err.message);
    process.exit(1);
  }
})();
