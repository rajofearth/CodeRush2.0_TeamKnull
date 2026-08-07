import assert from "node:assert/strict";
import { UserDirectory } from "./users.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

(async () => {
  try {
    const dir = new UserDirectory([{ id: "1", name: "a" }, { id: "2", name: "b" }]);
    assert.equal(dir.findById("2").name, "b");
    assert.equal(dir.findById("9"), undefined);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "users.mjs"), "utf8");
    assert.ok(src.includes("new Map"));
    assert.ok(!src.includes(".find("));
    console.log("PASS optimize-lookup-index");
  } catch (err) {
    console.error("FAIL optimize-lookup-index:", err.message);
    process.exit(1);
  }
})();
