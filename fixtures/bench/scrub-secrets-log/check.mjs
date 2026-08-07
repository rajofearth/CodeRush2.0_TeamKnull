import assert from "node:assert/strict";
import { scrubSecrets } from "./scrub.mjs";

(async () => {
  try {
    const line = "key=sk-abc1234567890 token=AKIAIOSFODNN7EXAMPLE";
    const out = scrubSecrets(line);
    assert.ok(!out.includes("sk-abc"));
    assert.ok(!out.includes("AKIAIOSFODNN7EXAMPLE"));
    assert.ok(out.includes("[REDACTED]"));
    console.log("PASS scrub-secrets-log");
  } catch (err) {
    console.error("FAIL scrub-secrets-log:", err.message);
    process.exit(1);
  }
})();
