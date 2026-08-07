import assert from "node:assert/strict";
import { UniqueStore } from "./store.mjs";

(async () => {
  try {
    const s = new UniqueStore();
    s.put("a", 1);
    assert.throws(() => s.put("a", 2));
    s.set("a", 3, true);
    assert.equal(s.map.get("a"), 3);
    console.log("PASS add-unique-key-guard");
  } catch (err) {
    console.error("FAIL add-unique-key-guard:", err.message);
    process.exit(1);
  }
})();
