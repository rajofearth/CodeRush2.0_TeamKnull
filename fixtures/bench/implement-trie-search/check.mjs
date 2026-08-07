import assert from "node:assert/strict";
import { Trie } from "./trie.mjs";

(async () => {
  try {
    const t = new Trie();
    t.insert("apple");
    t.insert("app");
    assert.equal(t.startsWith("ap"), true);
    assert.equal(t.startsWith("ban"), false);
    console.log("PASS implement-trie-search");
  } catch (err) {
    console.error("FAIL implement-trie-search:", err.message);
    process.exit(1);
  }
})();
