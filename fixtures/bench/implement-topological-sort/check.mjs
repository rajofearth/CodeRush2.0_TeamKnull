import assert from "node:assert/strict";
import { topoSort } from "./topo.mjs";

(async () => {
  try {
    const order = topoSort({ app: ["db"], db: ["lib"], lib: [] });
    assert.ok(order.indexOf("lib") < order.indexOf("db"));
    assert.ok(order.indexOf("db") < order.indexOf("app"));
    console.log("PASS implement-topological-sort");
  } catch (err) {
    console.error("FAIL implement-topological-sort:", err.message);
    process.exit(1);
  }
})();
