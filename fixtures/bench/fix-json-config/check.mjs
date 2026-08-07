import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  const config = JSON.parse(readFileSync(path.join(here, "config.json"), "utf8"));
  assert.equal(config.name, "widget-service");
  assert.equal(config.port, 8080);
  assert.equal(config.retries, 3, "retries must be the number 3");
  assert.deepEqual(config.features, ["alpha", "beta"]);

  const out = execFileSync(process.execPath, ["app.mjs"], {
    cwd: here,
    stdio: "pipe",
  }).toString();
  assert.ok(
    out.includes("widget-service on :8080, retries=3, features=alpha+beta"),
    `unexpected app output: ${out.trim()}`,
  );
  console.log("PASS fix-json-config");
} catch (err) {
  console.error("FAIL fix-json-config:", err.message);
  process.exit(1);
}
