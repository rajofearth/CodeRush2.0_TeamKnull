import assert from "node:assert/strict";
import { corsMiddleware } from "./cors.mjs";

(async () => {
  try {
    const mw = corsMiddleware({ origin: "https://example.com" });
    const res = { headers: {} };
    mw({}, res, () => {});
    assert.equal(res.headers["Access-Control-Allow-Origin"], "https://example.com");
    console.log("PASS add-cors-middleware");
  } catch (err) {
    console.error("FAIL add-cors-middleware:", err.message);
    process.exit(1);
  }
})();
