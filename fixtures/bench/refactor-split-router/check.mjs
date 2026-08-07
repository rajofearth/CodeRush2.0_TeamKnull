import assert from "node:assert/strict";
import { handle } from "./server.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

(async () => {
  try {
    assert.deepEqual(handle("/health"), { status: 200, body: "ok" });
    assert.deepEqual(handle("/version"), { status: 200, body: "1.0.0" });
    assert.deepEqual(handle("/nope"), { status: 404, body: "not found" });
    const here = path.dirname(fileURLToPath(import.meta.url));
    const serverSrc = readFileSync(path.join(here, "server.mjs"), "utf8");
    assert.ok(serverSrc.includes('./router.mjs'));
    console.log("PASS refactor-split-router");
  } catch (err) {
    console.error("FAIL refactor-split-router:", err.message);
    process.exit(1);
  }
})();
