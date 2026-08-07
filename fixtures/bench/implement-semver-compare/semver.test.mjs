import assert from "node:assert/strict";
import { compareSemver } from "./semver.mjs";
assert.equal(compareSemver("1.2.3", "1.2.4"), -1);
assert.equal(compareSemver("2.0.0", "1.9.9"), 1);
assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
console.log("semver tests ok");
