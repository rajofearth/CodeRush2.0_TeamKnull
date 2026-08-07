import assert from "node:assert/strict";
import { PackageIndex } from "./index.mjs";

(async () => {
  try {
    const idx = new PackageIndex({ lodash: { versions: { "4.17.21": "/pkgs/lodash-4.17.21.tgz" } } });
    assert.equal(idx.resolve("lodash", "4.17.21"), "/pkgs/lodash-4.17.21.tgz");
    assert.equal(idx.resolve("lodash", "1.0.0"), null);
    console.log("PASS local-package-index");
  } catch (err) {
    console.error("FAIL local-package-index:", err.message);
    process.exit(1);
  }
})();
