import assert from "node:assert/strict";
import { safeJoin } from "./paths.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

(async () => {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "data-root");
    assert.equal(safeJoin(root, "logs/a.txt"), path.resolve(root, "logs/a.txt"));
    assert.throws(() => safeJoin(root, "../outside.txt"));
    console.log("PASS fix-path-traversal");
  } catch (err) {
    console.error("FAIL fix-path-traversal:", err.message);
    process.exit(1);
  }
})();
