import assert from "node:assert/strict";
import { EventBus } from "./bus.mjs";

(async () => {
  try {
    const bus = new EventBus();
    let n = 0;
    const fn = () => n++;
    bus.on("x", fn);
    bus.emit("x");
    bus.off("x", fn);
    bus.emit("x");
    assert.equal(n, 1);
    console.log("PASS fix-event-listener-leak");
  } catch (err) {
    console.error("FAIL fix-event-listener-leak:", err.message);
    process.exit(1);
  }
})();
