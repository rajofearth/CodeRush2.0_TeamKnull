import assert from "node:assert/strict";
import { encodeCursor, decodeCursor } from "./cursor.mjs";

(async () => {
  try {
    const tok = encodeCursor({ id: "abc" });
    assert.deepEqual(decodeCursor(tok), { id: "abc" });
    console.log("PASS add-pagination-cursor");
  } catch (err) {
    console.error("FAIL add-pagination-cursor:", err.message);
    process.exit(1);
  }
})();
