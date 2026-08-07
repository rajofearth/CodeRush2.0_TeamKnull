import assert from "node:assert/strict";
import { healthHandler } from "./health.mjs";

(async () => {
  try {
    assert.deepEqual(healthHandler({ ready: true }), { status: "ok", code: 200 });
    assert.deepEqual(healthHandler({ ready: false }), { status: "error", code: 503 });
    console.log("PASS add-health-check-route");
  } catch (err) {
    console.error("FAIL add-health-check-route:", err.message);
    process.exit(1);
  }
})();
