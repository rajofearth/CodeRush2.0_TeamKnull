import assert from "node:assert/strict";
import { tokenize } from "./shell.mjs";

(async () => {
  try {
    assert.deepEqual(tokenize('echo "hello world"'), ["echo", "hello world"]);
    assert.deepEqual(tokenize("ls -la '/tmp/a b'"), ["ls", "-la", "/tmp/a b"]);
    console.log("PASS parse-shell-command");
  } catch (err) {
    console.error("FAIL parse-shell-command:", err.message);
    process.exit(1);
  }
})();
