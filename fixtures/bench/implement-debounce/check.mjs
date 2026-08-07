import assert from "node:assert/strict";
import { debounce } from "./debounce.mjs";

(async () => {
  try {
    let n = 0;
    const fn = debounce(() => n++, 20);
    fn(); fn(); fn();
    await new Promise((r) => setTimeout(r, 35));
    assert.equal(n, 1);
    console.log("PASS implement-debounce");
  } catch (err) {
    console.error("FAIL implement-debounce:", err.message);
    process.exit(1);
  }
})();
