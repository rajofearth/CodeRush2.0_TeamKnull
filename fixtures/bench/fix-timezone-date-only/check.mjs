import assert from "node:assert/strict";
import { parseDateOnly } from "./dates.mjs";

(async () => {
  try {
    const dt = parseDateOnly("2024-06-15");
    assert.equal(dt.toISOString(), "2024-06-15T00:00:00.000Z");
    console.log("PASS fix-timezone-date-only");
  } catch (err) {
    console.error("FAIL fix-timezone-date-only:", err.message);
    process.exit(1);
  }
})();
