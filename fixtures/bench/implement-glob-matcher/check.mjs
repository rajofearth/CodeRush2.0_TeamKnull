import assert from "node:assert/strict";
import { globMatch } from "./glob.mjs";

(async () => {
  try {
    assert.equal(globMatch("src/**/*.js", "src/a/b.js"), true);
    assert.equal(globMatch("*.txt", "a.txt"), true);
    assert.equal(globMatch("*.txt", "a.md"), false);
    console.log("PASS implement-glob-matcher");
  } catch (err) {
    console.error("FAIL implement-glob-matcher:", err.message);
    process.exit(1);
  }
})();
