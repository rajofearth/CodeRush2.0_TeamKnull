import assert from "node:assert/strict";
import { TxLog } from "./tx.mjs";

(async () => {
  try {
    const tx = new TxLog({ n: 1 });
    tx.apply((s) => { s.n = 2; });
    assert.equal(tx.state.n, 2);
    tx.rollback();
    assert.equal(tx.state.n, 1);
    console.log("PASS add-transaction-log");
  } catch (err) {
    console.error("FAIL add-transaction-log:", err.message);
    process.exit(1);
  }
})();
