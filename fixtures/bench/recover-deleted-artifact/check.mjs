import assert from "node:assert/strict";
import { recoverLatest } from "./recover.mjs";

(async () => {
  try {
    const backups = [{ ts: 1, data: "a" }, { ts: 3, data: "c" }, { ts: 2, data: "b" }];
    assert.deepEqual(recoverLatest(backups), { ts: 3, data: "c" });
    console.log("PASS recover-deleted-artifact");
  } catch (err) {
    console.error("FAIL recover-deleted-artifact:", err.message);
    process.exit(1);
  }
})();
