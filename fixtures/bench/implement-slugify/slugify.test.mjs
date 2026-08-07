import assert from "node:assert/strict";
import { slugify } from "./slugify.mjs";

assert.equal(slugify("Hello, World!"), "hello-world");
assert.equal(slugify("  --Already--Sluggish--  "), "already-sluggish");
assert.equal(slugify("Multiple   Spaces"), "multiple-spaces");
assert.equal(slugify("v2.0 (beta)"), "v2-0-beta");
assert.equal(slugify("!!!"), "");
assert.equal(slugify("plain"), "plain");
assert.equal(slugify(42), "42");
console.log("slugify tests passed");
