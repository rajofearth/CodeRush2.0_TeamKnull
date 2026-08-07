import assert from "node:assert/strict";
import { isEmail } from "./email.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

(async () => {
  try {
    assert.equal(isEmail("ada@example.com"), true);
    assert.equal(isEmail("not-an-email"), false);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "email.mjs"), "utf8");
    assert.ok(!src.includes("([a-z]+)+"));
    console.log("PASS fix-regex-catastrophic");
  } catch (err) {
    console.error("FAIL fix-regex-catastrophic:", err.message);
    process.exit(1);
  }
})();
