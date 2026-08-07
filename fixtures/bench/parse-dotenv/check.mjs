import assert from "node:assert/strict";
import { parseDotenv } from "./dotenv.mjs";

(async () => {
  try {
    const text = "# comment\nFOO=bar\nBAZ=\"quoted\"\n";
    assert.deepEqual(parseDotenv(text), { FOO: "bar", BAZ: "quoted" });
    console.log("PASS parse-dotenv");
  } catch (err) {
    console.error("FAIL parse-dotenv:", err.message);
    process.exit(1);
  }
})();
