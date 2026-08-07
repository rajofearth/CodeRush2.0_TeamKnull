import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfigAsync } from "./config.mjs";

(async () => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const p = path.join(here, "sample.json");
    await fs.writeFile(p, '{"ok":true}');
    const cfg = await readConfigAsync(p);
    assert.deepEqual(cfg, { ok: true });
    await fs.unlink(p);
    console.log("PASS promisify-callback-api");
  } catch (err) {
    console.error("FAIL promisify-callback-api:", err.message);
    process.exit(1);
  }
})();
