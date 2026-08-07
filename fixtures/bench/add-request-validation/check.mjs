import assert from "node:assert/strict";
import { validateCreateUser } from "./validate.mjs";

(async () => {
  try {
    assert.deepEqual(validateCreateUser({ name: "Ada", email: "a@b.co" }), { name: "Ada", email: "a@b.co" });
    assert.throws(() => validateCreateUser({ name: "Ada" }));
    assert.throws(() => validateCreateUser({ name: "Ada", email: "bad" }));
    console.log("PASS add-request-validation");
  } catch (err) {
    console.error("FAIL add-request-validation:", err.message);
    process.exit(1);
  }
})();
