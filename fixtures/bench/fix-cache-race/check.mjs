import assert from "node:assert/strict";
import { AsyncCache } from "./cache.mjs";

(async () => {
  try {
    const c = new AsyncCache();
    let loads = 0;
    const loader = async () => { loads++; await new Promise((r) => setTimeout(r, 5)); return 42; };
    const [a, b] = await Promise.all([c.get("x", loader), c.get("x", loader)]);
    assert.equal(a, 42);
    assert.equal(b, 42);
    assert.equal(loads, 1);
    console.log("PASS fix-cache-race");
  } catch (err) {
    console.error("FAIL fix-cache-race:", err.message);
    process.exit(1);
  }
})();
