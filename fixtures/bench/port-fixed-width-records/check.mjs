import assert from "node:assert/strict";
import { parseRecords } from "./records.mjs";

(async () => {
  try {
    const line = "001".padEnd(20, " ") + "Ada Lovelace".padEnd(30, " ");
    const rows = parseRecords([line]);
    assert.deepEqual(rows, [{ id: "001", name: "Ada Lovelace" }]);
    console.log("PASS port-fixed-width-records");
  } catch (err) {
    console.error("FAIL port-fixed-width-records:", err.message);
    process.exit(1);
  }
})();
