import assert from "node:assert/strict";
import { TokenBucket } from "./bucket.mjs";

(async () => {
  try {
    const b = new TokenBucket({ capacity: 2, refillPerMs: 0 });
    b.consume(1);
    b.consume(1);
    assert.throws(() => b.consume(1));
    console.log("PASS implement-token-bucket");
  } catch (err) {
    console.error("FAIL implement-token-bucket:", err.message);
    process.exit(1);
  }
})();
