import assert from "node:assert/strict";
import { App } from "./app.mjs";

(async () => {
  try {
    const app = new App();
    const log = [];
    app.use(async () => log.push(1));
    app.use(async () => log.push(2));
    await app.handle({});
    assert.deepEqual(log, [1, 2]);
    console.log("PASS fix-middleware-order");
  } catch (err) {
    console.error("FAIL fix-middleware-order:", err.message);
    process.exit(1);
  }
})();
