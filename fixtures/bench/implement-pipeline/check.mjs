import assert from "node:assert/strict";
import { pipeline } from "./pipeline.mjs";

(async () => {
  try {
    const run = pipeline([
    async (x) => x + 1,
    async (x) => x * 2,
    ]);
    assert.equal(await run(3), 8);
    console.log("PASS implement-pipeline");
  } catch (err) {
    console.error("FAIL implement-pipeline:", err.message);
    process.exit(1);
  }
})();
