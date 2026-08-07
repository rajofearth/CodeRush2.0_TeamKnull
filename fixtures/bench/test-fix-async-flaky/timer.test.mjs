import assert from "node:assert/strict";
import { delay } from "./timer.mjs";
delay(1000).then(() => {
  assert.ok(true);
  console.log("timer test ok");
});
// exits before timer fires — treated as failure
assert.fail("must await delay()");
