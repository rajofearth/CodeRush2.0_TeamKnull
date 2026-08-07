import assert from "node:assert/strict";
import { throttle } from "./throttle.mjs";

(async () => {
  try {
    let n = 0;
    const fn = throttle(() => n++, 30);
    fn(); fn(); fn();
    assert.equal(n, 1);
    await new Promise((r) => setTimeout(r, 35));
    fn();
    assert.equal(n, 2);
    console.log("PASS implement-throttle");
  } catch (err) {
    console.error("FAIL implement-throttle:", err.message);
    process.exit(1);
  }
})();
