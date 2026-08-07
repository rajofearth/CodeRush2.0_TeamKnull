import assert from "node:assert/strict";
import { walkTree } from "./walk.mjs";

(async () => {
  try {
    const deep = { id: 0, children: [] };
    let cur = deep;
    for (let i = 1; i < 5000; i++) {
    cur.children = [{ id: i, children: [] }];
    cur = cur.children[0];
    }
    const seen = [];
    walkTree(deep, (n) => seen.push(n.id));
    assert.equal(seen.length, 5000);
    console.log("PASS fix-stack-overflow-dfs");
  } catch (err) {
    console.error("FAIL fix-stack-overflow-dfs:", err.message);
    process.exit(1);
  }
})();
