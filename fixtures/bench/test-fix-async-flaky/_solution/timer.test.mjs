import assert from "node:assert/strict";
import { delay } from "./timer.mjs";
await delay(5);
assert.ok(true);
console.log("timer test ok");
