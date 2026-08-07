import assert from "node:assert/strict";
import { SnapshotListeners } from "./listeners.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

(async () => {
  try {
    const bus = new SnapshotListeners();
    const order = [];
    const c = () => order.push("c");
    bus.on(() => {
    bus.off(c);
    order.push("a");
    });
    bus.on(() => order.push("b"));
    bus.on(c);
    bus.emit(0);
    assert.deepEqual(order, ["a", "b", "c"]);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "listeners.mjs"), "utf8");
    assert.ok(src.includes("[...this.fns]"));
    console.log("PASS fix-iterator-invalidation");
  } catch (err) {
    console.error("FAIL fix-iterator-invalidation:", err.message);
    process.exit(1);
  }
})();
