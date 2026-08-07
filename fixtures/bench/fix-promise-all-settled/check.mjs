import assert from "node:assert/strict";
import { allSettled } from "./settle.mjs";

(async () => {
  try {
    const res = await allSettled([Promise.resolve(1), Promise.reject(new Error("x"))]);
    assert.equal(res[0].status, "fulfilled");
    assert.equal(res[1].status, "rejected");
    console.log("PASS fix-promise-all-settled");
  } catch (err) {
    console.error("FAIL fix-promise-all-settled:", err.message);
    process.exit(1);
  }
})();
