import assert from "node:assert/strict";
import { buildQuery } from "./query.mjs";

(async () => {
  try {
    const q = buildQuery("users", "1; DROP TABLE users");
    assert.ok(!q.sql.includes("DROP"));
    assert.deepEqual(q.params, ["1; DROP TABLE users"]);
    console.log("PASS fix-sql-injection-pattern");
  } catch (err) {
    console.error("FAIL fix-sql-injection-pattern:", err.message);
    process.exit(1);
  }
})();
