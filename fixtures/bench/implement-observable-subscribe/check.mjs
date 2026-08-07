import assert from "node:assert/strict";
import { Observable } from "./observable.mjs";

(async () => {
  try {
    const obs = new Observable();
    let seen = 0;
    const off = obs.subscribe((v) => { seen = v; });
    obs.emit(5);
    assert.equal(seen, 5);
    off();
    obs.emit(9);
    assert.equal(seen, 5);
    console.log("PASS implement-observable-subscribe");
  } catch (err) {
    console.error("FAIL implement-observable-subscribe:", err.message);
    process.exit(1);
  }
})();
