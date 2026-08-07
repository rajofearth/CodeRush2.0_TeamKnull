import assert from "node:assert/strict";
import { sanitizeHtml } from "./sanitize.mjs";

(async () => {
  try {
    const dirty = '<p onclick="alert(1)">hi<script>evil()</script></p><a href="javascript:alert(1)">x</a>';
    const clean = sanitizeHtml(dirty);
    assert.ok(!clean.includes("<script"));
    assert.ok(!clean.includes("onclick"));
    assert.ok(!clean.includes("javascript:"));
    assert.ok(clean.includes("<p>hi</p>"));
    console.log("PASS sanitize-html");
  } catch (err) {
    console.error("FAIL sanitize-html:", err.message);
    process.exit(1);
  }
})();
