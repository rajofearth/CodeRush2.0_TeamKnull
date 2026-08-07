import assert from "node:assert/strict";
import { ShutdownManager } from "./shutdown.mjs";

(async () => {
  try {
    const mgr = new ShutdownManager();
    const log = [];
    mgr.onShutdown(async () => { log.push(1); });
    mgr.onShutdown(async () => { log.push(2); });
    await mgr.shutdown();
    assert.deepEqual(log, [1, 2]);
    console.log("PASS add-graceful-shutdown");
  } catch (err) {
    console.error("FAIL add-graceful-shutdown:", err.message);
    process.exit(1);
  }
})();
