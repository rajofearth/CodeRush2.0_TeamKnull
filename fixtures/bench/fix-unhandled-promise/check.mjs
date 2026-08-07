import assert from "node:assert/strict";
import { runTracked } from "./track.mjs";

(async () => {
  try {
    let seen = null;
    runTracked(Promise.reject(new Error("boom")), (e) => {
    seen = e.message;
    });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(seen, "boom");
    console.log("PASS fix-unhandled-promise");
  } catch (err) {
    console.error("FAIL fix-unhandled-promise:", err.message);
    process.exit(1);
  }
})();
