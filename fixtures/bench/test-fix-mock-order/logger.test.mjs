import assert from "node:assert/strict";
import { logSequence } from "./logger.mjs";
const calls = [];
logSequence((level, msg) => calls.push([level, msg]));
assert.deepEqual(calls, [["info", "ready"], ["warn", "setup"]]);
console.log("logger test ok");
