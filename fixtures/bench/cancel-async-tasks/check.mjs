import assert from "node:assert/strict";
import { TaskRunner } from "./runner.mjs";

(async () => {
  try {
    const runner = new TaskRunner();
    const ctrl = new AbortController();
    let settled = false;
    let release;
    const entered = new Promise((r) => { release = r; });
    const slow = runner.run(async () => {
    release();
    await new Promise((r) => setTimeout(r, 50));
    settled = true;
    return "done";
    }, { signal: ctrl.signal });
    await entered;
    ctrl.abort();
    await assert.rejects(() => slow, (e) => e.name === "AbortError");
    assert.equal(settled, false);
    console.log("PASS cancel-async-tasks");
  } catch (err) {
    console.error("FAIL cancel-async-tasks:", err.message);
    process.exit(1);
  }
})();
