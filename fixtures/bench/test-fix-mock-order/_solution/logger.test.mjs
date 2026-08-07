import assert from "node:assert/strict";
import { logSequence } from "./logger.mjs";
const calls = [];
logSequence((level, msg) => calls.push([level, msg]));
assert.deepEqual(calls, [["warn", "setup"], ["info", "ready"]]);
console.log("logger test ok");
