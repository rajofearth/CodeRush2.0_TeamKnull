/**
 * DeepSWE inspired tasks adapted to compact Node.js mini-repos.
 */

import { multiFileTask, singleModuleTask, specAndTestTask } from "./builders.js";
import type { CatalogTask } from "./types.js";

const ds = (taskId: string) => ({ benchmark: "deepswe" as const, taskId });

export const deepSweTasks: CatalogTask[] = [
  specAndTestTask({
    id: "add-config-file-parser",
    title: "Add JSON config file parser",
    source: ds("cliffy-config-parser"),
    category: "feature",
    prompt:
      "Implement loadConfig(path) in config-loader.mjs per SPEC.md. It must read JSON and validate required fields.",
    module: "config-loader.mjs",
    stub: `import fs from "node:fs/promises";

export async function loadConfig(path) {
  throw new Error("not implemented");
}
`,
    fixed: `import fs from "node:fs/promises";

export async function loadConfig(path) {
  const text = await fs.readFile(path, "utf8");
  const cfg = JSON.parse(text);
  if (typeof cfg.port !== "number" || typeof cfg.host !== "string") {
    throw new Error("invalid config");
  }
  return cfg;
}
`,
    spec: `# Config loader\nloadConfig reads JSON with required numeric \`port\` and string \`host\`.`,
    testFile: "config-loader.test.mjs",
    testContent: `import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config-loader.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(here, "sample-config.json");
await fs.writeFile(p, JSON.stringify({ host: "127.0.0.1", port: 3000 }));
const cfg = await loadConfig(p);
assert.deepEqual(cfg, { host: "127.0.0.1", port: 3000 });
await fs.unlink(p);
console.log("config-loader ok");
`,
  }),

  singleModuleTask({
    id: "add-request-validation",
    title: "Validate request body fields",
    source: ds("request-validation-middleware"),
    category: "feature",
    prompt: "validateCreateUser(body) in validate.mjs throws on missing name/email or invalid email.",
    module: "validate.mjs",
    broken: `export function validateCreateUser(body) {
  return body;
}
`,
    fixed: `export function validateCreateUser(body) {
  if (!body?.name || !body?.email) throw new Error("missing fields");
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(body.email)) throw new Error("invalid email");
  return { name: String(body.name), email: String(body.email) };
}
`,
    testBody: `
  import { validateCreateUser } from "./validate.mjs";
  assert.deepEqual(validateCreateUser({ name: "Ada", email: "a@b.co" }), { name: "Ada", email: "a@b.co" });
  assert.throws(() => validateCreateUser({ name: "Ada" }));
  assert.throws(() => validateCreateUser({ name: "Ada", email: "bad" }));
`,
  }),

  singleModuleTask({
    id: "add-graceful-shutdown",
    title: "Drain hooks on shutdown signal",
    source: ds("graceful-shutdown-hooks"),
    category: "feature",
    prompt: "ShutdownManager in shutdown.mjs runs registered async hooks in order when shutdown() is called.",
    module: "shutdown.mjs",
    broken: `export class ShutdownManager {
  constructor() {
    this.hooks = [];
  }
  onShutdown(fn) {
    this.hooks.push(fn);
  }
  async shutdown() {
    // bug: hooks never run
  }
}
`,
    fixed: `export class ShutdownManager {
  constructor() {
    this.hooks = [];
  }
  onShutdown(fn) {
    this.hooks.push(fn);
  }
  async shutdown() {
    for (const fn of this.hooks) {
      await fn();
    }
  }
}
`,
    testBody: `
  import { ShutdownManager } from "./shutdown.mjs";
  const mgr = new ShutdownManager();
  const log = [];
  mgr.onShutdown(async () => { log.push(1); });
  mgr.onShutdown(async () => { log.push(2); });
  await mgr.shutdown();
  assert.deepEqual(log, [1, 2]);
`,
  }),

  singleModuleTask({
    id: "add-pagination-cursor",
    title: "Encode/decode pagination cursor",
    source: ds("pagination-cursor-helper"),
    category: "feature",
    prompt: "encodeCursor({id}) and decodeCursor(token) in cursor.mjs round-trip opaque cursors.",
    module: "cursor.mjs",
    broken: `export function encodeCursor(obj) {
  return JSON.stringify(obj);
}
export function decodeCursor(token) {
  return token;
}
`,
    fixed: `export function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}
export function decodeCursor(token) {
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
}
`,
    testBody: `
  import { encodeCursor, decodeCursor } from "./cursor.mjs";
  const tok = encodeCursor({ id: "abc" });
  assert.deepEqual(decodeCursor(tok), { id: "abc" });
`,
  }),

  singleModuleTask({
    id: "add-health-check-route",
    title: "Implement health handler returning status",
    source: ds("health-check-endpoint"),
    category: "feature",
    prompt: "healthHandler(deps) in health.mjs returns { status: 'ok' } when deps.ready is true, else 503 shape.",
    module: "health.mjs",
    broken: `export function healthHandler(deps) {
  return { status: "ok" };
}
`,
    fixed: `export function healthHandler(deps) {
  if (!deps.ready) return { status: "error", code: 503 };
  return { status: "ok", code: 200 };
}
`,
    testBody: `
  import { healthHandler } from "./health.mjs";
  assert.deepEqual(healthHandler({ ready: true }), { status: "ok", code: 200 });
  assert.deepEqual(healthHandler({ ready: false }), { status: "error", code: 503 });
`,
  }),

  singleModuleTask({
    id: "add-cors-middleware",
    title: "Add CORS headers middleware",
    source: ds("cors-middleware"),
    category: "feature",
    prompt: "corsMiddleware(options) in cors.mjs sets Access-Control-Allow-Origin on response headers.",
    module: "cors.mjs",
    broken: `export function corsMiddleware(options) {
  return (_req, res, next) => next();
}
`,
    fixed: `export function corsMiddleware(options) {
  return (_req, res, next) => {
    res.headers = res.headers ?? {};
    res.headers["Access-Control-Allow-Origin"] = options.origin ?? "*";
    next();
  };
}
`,
    testBody: `
  import { corsMiddleware } from "./cors.mjs";
  const mw = corsMiddleware({ origin: "https://example.com" });
  const res = { headers: {} };
  mw({}, res, () => {});
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://example.com");
`,
  }),

  singleModuleTask({
    id: "add-request-timeout",
    title: "Race async work against timeout",
    source: ds("request-timeout-wrapper"),
    category: "feature",
    prompt: "withTimeout(promise, ms) in timeout.mjs rejects with TimeoutError when ms elapses first.",
    module: "timeout.mjs",
    broken: `export async function withTimeout(promise, ms) {
  void ms;
  throw new Error("not implemented");
}
`,
    fixed: `export async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("TimeoutError")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
`,
    testBody: `
  import { withTimeout } from "./timeout.mjs";
  await assert.rejects(() => withTimeout(new Promise(() => {}), 20), /TimeoutError/);
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
`,
  }),

  singleModuleTask({
    id: "add-retry-transient-errors",
    title: "Retry only transient HTTP status codes",
    source: ds("retry-transient-errors"),
    category: "feature",
    prompt: "shouldRetry(status) in retry-http.mjs returns true for 429 and 5xx only.",
    module: "retry-http.mjs",
    broken: `export function shouldRetry(status) {
  return true;
}
`,
    fixed: `export function shouldRetry(status) {
  return status === 429 || (status >= 500 && status <= 599);
}
`,
    testBody: `
  import { shouldRetry } from "./retry-http.mjs";
  assert.equal(shouldRetry(429), true);
  assert.equal(shouldRetry(503), true);
  assert.equal(shouldRetry(404), false);
  assert.equal(shouldRetry(200), false);
`,
  }),

  singleModuleTask({
    id: "implement-diff-lines",
    title: "Line diff between two texts",
    source: ds("xml-diff-lines"),
    category: "feature",
    prompt: "diffLines(a,b) in diff.mjs returns { added, removed } line arrays (set difference by line).",
    module: "diff.mjs",
    broken: `export function diffLines(a, b) {
  return { added: [], removed: [] };
}
`,
    fixed: `export function diffLines(a, b) {
  const la = a.split("\\n");
  const lb = b.split("\\n");
  const sa = new Set(la);
  const sb = new Set(lb);
  return {
    added: lb.filter((l) => !sa.has(l)),
    removed: la.filter((l) => !sb.has(l)),
  };
}
`,
    testBody: `
  import { diffLines } from "./diff.mjs";
  const d = diffLines("a\\nb\\n", "b\\nc\\n");
  assert.deepEqual(d.removed, ["a"]);
  assert.deepEqual(d.added, ["c"]);
`,
  }),

  singleModuleTask({
    id: "implement-apply-patch",
    title: "Apply unified line patch",
    source: ds("xml-patch-apply"),
    category: "feature",
    prompt:
      "applyPatch(original, patch) in patch.mjs applies lines starting with ' ' keep, '+' add, '-' remove.",
    module: "patch.mjs",
    broken: `export function applyPatch(original, patch) {
  return original;
}
`,
    fixed: `export function applyPatch(original, patch) {
  const out = original.split("\\n");
  const lines = patch.split("\\n");
  let i = 0;
  for (const line of lines) {
    if (!line) continue;
    const tag = line[0];
    const text = line.slice(1);
    if (tag === " ") {
      if (out[i] !== text) throw new Error("patch mismatch");
      i++;
    } else if (tag === "-") {
      if (out[i] !== text) throw new Error("patch mismatch");
      out.splice(i, 1);
    } else if (tag === "+") {
      out.splice(i, 0, text);
      i++;
    }
  }
  return out.join("\\n");
}
`,
    testBody: `
  import { applyPatch } from "./patch.mjs";
  const orig = "a\\nb\\nc";
  const patched = applyPatch(orig, " a\\n-b\\n+b2\\n c");
  assert.equal(patched, "a\\nb2\\nc");
`,
  }),

  singleModuleTask({
    id: "implement-debounce",
    title: "Debounce function calls",
    source: ds("debounce-helper"),
    category: "feature",
    prompt: "debounce(fn, waitMs) in debounce.mjs delays invocation until waitMs after last call.",
    module: "debounce.mjs",
    broken: `export function debounce(fn, waitMs) {
  return fn;
}
`,
    fixed: `export function debounce(fn, waitMs) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}
`,
    testBody: `
  import { debounce } from "./debounce.mjs";
  let n = 0;
  const fn = debounce(() => n++, 20);
  fn(); fn(); fn();
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(n, 1);
`,
  }),

  singleModuleTask({
    id: "implement-throttle",
    title: "Throttle function calls",
    source: ds("throttle-helper"),
    category: "feature",
    prompt: "throttle(fn, waitMs) in throttle.mjs invokes at most once per waitMs window.",
    module: "throttle.mjs",
    broken: `export function throttle(fn, waitMs) {
  return fn;
}
`,
    fixed: `export function throttle(fn, waitMs) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= waitMs) {
      last = now;
      fn(...args);
    }
  };
}
`,
    testBody: `
  import { throttle } from "./throttle.mjs";
  let n = 0;
  const fn = throttle(() => n++, 30);
  fn(); fn(); fn();
  assert.equal(n, 1);
  await new Promise((r) => setTimeout(r, 35));
  fn();
  assert.equal(n, 2);
`,
  }),

  singleModuleTask({
    id: "implement-queue-processor",
    title: "Process jobs sequentially from queue",
    source: ds("queue-worker"),
    category: "feature",
    prompt: "JobQueue in queue.mjs processes enqueued async jobs one at a time in FIFO order.",
    module: "queue.mjs",
    broken: `export class JobQueue {
  constructor() {
    this.jobs = [];
  }
  enqueue(job) {
    this.jobs.push(job);
  }
  async drain() {
    return Promise.all(this.jobs.map((j) => j()));
  }
}
`,
    fixed: `export class JobQueue {
  constructor() {
    this.jobs = [];
    this._chain = Promise.resolve();
  }
  enqueue(job) {
    this.jobs.push(job);
  }
  async drain() {
    const results = [];
    for (const job of this.jobs) {
      this._chain = this._chain.then(async () => {
        results.push(await job());
      });
    }
    await this._chain;
    return results;
  }
}
`,
    testBody: `
  import { JobQueue } from "./queue.mjs";
  const q = new JobQueue();
  const order = [];
  q.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 15));
    order.push(1);
  });
  q.enqueue(async () => {
    order.push(2);
  });
  await q.drain();
  assert.deepEqual(order, [1, 2]);
`,
  }),

  singleModuleTask({
    id: "implement-stable-sort",
    title: "Stable sort by key",
    source: ds("stable-sort-helper"),
    category: "feature",
    prompt: "stableSort(items, keyFn) in sort.mjs sorts by key while preserving order for equal keys.",
    module: "sort.mjs",
    broken: `export function stableSort(items, keyFn) {
  return [...items].sort((a, b) => keyFn(b) - keyFn(a));
}
`,
    fixed: `export function stableSort(items, keyFn) {
  return items
    .map((item, index) => ({ item, index, key: keyFn(item) }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((x) => x.item);
}
`,
    testBody: `
  import { stableSort } from "./sort.mjs";
  const items = [{ v: 1, id: "a" }, { v: 1, id: "b" }, { v: 0, id: "c" }];
  const sorted = stableSort(items, (x) => x.v);
  assert.deepEqual(sorted.map((x) => x.id), ["c", "a", "b"]);
`,
  }),

  singleModuleTask({
    id: "add-cache-with-ttl",
    title: "Memoize with TTL expiry",
    source: ds("cache-ttl-invalidation"),
    category: "feature",
    prompt: "ttlMemo(fn, ttlMs) in memo.mjs caches results until ttlMs expires.",
    module: "memo.mjs",
    broken: `export function ttlMemo(fn, ttlMs) {
  return fn;
}
`,
    fixed: `export function ttlMemo(fn, ttlMs) {
  const cache = new Map();
  return (key) => {
    const hit = cache.get(key);
    if (hit && Date.now() < hit.expires) return hit.value;
    const value = fn(key);
    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  };
}
`,
    testBody: `
  import { ttlMemo } from "./memo.mjs";
  let calls = 0;
  const fn = ttlMemo((k) => { calls++; return k.length; }, 50);
  assert.equal(fn("abc"), 3);
  assert.equal(fn("abc"), 3);
  assert.equal(calls, 1);
  await new Promise((r) => setTimeout(r, 55));
  assert.equal(fn("abc"), 3);
  assert.equal(calls, 2);
`,
  }),

  singleModuleTask({
    id: "add-transaction-log",
    title: "Append-only transaction log with rollback",
    source: ds("transaction-log-rollback"),
    category: "feature",
    prompt: "TxLog in tx.mjs supports apply(mutator) and rollback() restoring prior state snapshot.",
    module: "tx.mjs",
    broken: `export class TxLog {
  constructor(state) {
    this.state = state;
  }
  apply(mutator) {
    mutator(this.state);
  }
  rollback() {
    // no-op
  }
}
`,
    fixed: `export class TxLog {
  constructor(state) {
    this.state = state;
    this._snapshots = [];
  }
  apply(mutator) {
    this._snapshots.push(structuredClone(this.state));
    mutator(this.state);
  }
  rollback() {
    const prev = this._snapshots.pop();
    if (prev) this.state = prev;
  }
}
`,
    testBody: `
  import { TxLog } from "./tx.mjs";
  const tx = new TxLog({ n: 1 });
  tx.apply((s) => { s.n = 2; });
  assert.equal(tx.state.n, 2);
  tx.rollback();
  assert.equal(tx.state.n, 1);
`,
  }),

  singleModuleTask({
    id: "add-unique-key-guard",
    title: "Reject duplicate keys on insert",
    source: ds("unique-key-guard"),
    category: "feature",
    prompt: "UniqueStore in store.mjs throws on duplicate put(key) and overwrites only via set(key,val,force).",
    module: "store.mjs",
    broken: `export class UniqueStore {
  constructor() {
    this.map = new Map();
  }
  put(key, val) {
    this.map.set(key, val);
  }
}
`,
    fixed: `export class UniqueStore {
  constructor() {
    this.map = new Map();
  }
  put(key, val) {
    if (this.map.has(key)) throw new Error("duplicate key");
    this.map.set(key, val);
  }
  set(key, val, force = false) {
    if (this.map.has(key) && !force) throw new Error("duplicate key");
    this.map.set(key, val);
  }
}
`,
    testBody: `
  import { UniqueStore } from "./store.mjs";
  const s = new UniqueStore();
  s.put("a", 1);
  assert.throws(() => s.put("a", 2));
  s.set("a", 3, true);
  assert.equal(s.map.get("a"), 3);
`,
  }),

  singleModuleTask({
    id: "add-batch-flush",
    title: "Flush buffered items in batches",
    source: ds("batch-flush-processor"),
    category: "feature",
    prompt: "BatchBuffer in batch.mjs calls onFlush(batch) whenever size reaches batchSize.",
    module: "batch.mjs",
    broken: `export class BatchBuffer {
  constructor(batchSize, onFlush) {
    this.batchSize = batchSize;
    this.onFlush = onFlush;
    this.buf = [];
  }
  push(item) {
    this.buf.push(item);
  }
}
`,
    fixed: `export class BatchBuffer {
  constructor(batchSize, onFlush) {
    this.batchSize = batchSize;
    this.onFlush = onFlush;
    this.buf = [];
  }
  push(item) {
    this.buf.push(item);
    if (this.buf.length >= this.batchSize) {
      const batch = this.buf.splice(0, this.batchSize);
      this.onFlush(batch);
    }
  }
  flush() {
    if (this.buf.length) {
      this.onFlush(this.buf.splice(0));
    }
  }
}
`,
    testBody: `
  import { BatchBuffer } from "./batch.mjs";
  const batches = [];
  const bb = new BatchBuffer(2, (b) => batches.push(b));
  bb.push(1); bb.push(2); bb.push(3);
  assert.deepEqual(batches, [[1, 2]]);
  bb.flush();
  assert.deepEqual(batches[1], [3]);
`,
  }),

  singleModuleTask({
    id: "fix-cache-race",
    title: "Fix double-load race in async cache",
    source: ds("cache-race-fix"),
    category: "bugfix",
    prompt: "AsyncCache.get(key, loader) in cache.mjs must call loader once per key under concurrency.",
    module: "cache.mjs",
    broken: `export class AsyncCache {
  constructor() {
    this.map = new Map();
  }
  async get(key, loader) {
    if (this.map.has(key)) return this.map.get(key);
    const val = await loader();
    this.map.set(key, val);
    return val;
  }
}
`,
    fixed: `export class AsyncCache {
  constructor() {
    this.map = new Map();
    this.pending = new Map();
  }
  async get(key, loader) {
    if (this.map.has(key)) return this.map.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    const p = Promise.resolve().then(loader).then((val) => {
      this.map.set(key, val);
      this.pending.delete(key);
      return val;
    });
    this.pending.set(key, p);
    return p;
  }
}
`,
    testBody: `
  import { AsyncCache } from "./cache.mjs";
  const c = new AsyncCache();
  let loads = 0;
  const loader = async () => { loads++; await new Promise((r) => setTimeout(r, 5)); return 42; };
  const [a, b] = await Promise.all([c.get("x", loader), c.get("x", loader)]);
  assert.equal(a, 42);
  assert.equal(b, 42);
  assert.equal(loads, 1);
`,
  }),

  multiFileTask({
    id: "refactor-split-router",
    title: "Extract router from monolithic server file",
    source: ds("split-router-module"),
    category: "refactor",
    prompt:
      "Move route handlers from server.mjs into router.mjs. server.mjs must import { routes } from router.mjs and behavior must stay identical.",
    files: {
      "server.mjs": `export function handle(path) {
  if (path === "/health") return { status: 200, body: "ok" };
  if (path === "/version") return { status: 200, body: "1.0.0" };
  return { status: 404, body: "not found" };
}
`,
      "router.mjs": `// TODO: not used yet
export const routes = {};
`,
    },
    solution: {
      "server.mjs": `import { routes } from "./router.mjs";

export function handle(path) {
  const route = routes[path];
  if (route) return route();
  return { status: 404, body: "not found" };
}
`,
      "router.mjs": `export const routes = {
  "/health": () => ({ status: 200, body: "ok" }),
  "/version": () => ({ status: 200, body: "1.0.0" }),
};
`,
    },
    testBody: `
  import { handle } from "./server.mjs";
  import { readFileSync } from "node:fs";
  import { fileURLToPath } from "node:url";
  import path from "node:path";
  assert.deepEqual(handle("/health"), { status: 200, body: "ok" });
  assert.deepEqual(handle("/version"), { status: 200, body: "1.0.0" });
  assert.deepEqual(handle("/nope"), { status: 404, body: "not found" });
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverSrc = readFileSync(path.join(here, "server.mjs"), "utf8");
  assert.ok(serverSrc.includes('./router.mjs'));
`,
  }),

  multiFileTask({
    id: "refactor-extract-validator",
    title: "Extract shared validator module",
    source: ds("extract-validator-module"),
    category: "refactor",
    prompt:
      "Deduplicate isPositiveInt in order.mjs and cart.mjs by moving it to validators.mjs and importing it.",
    files: {
      "validators.mjs": `export function isPositiveInt(n) {
  throw new Error("not implemented");
}
`,
      "order.mjs": `function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}
export function validateOrder(qty) {
  if (!isPositiveInt(qty)) throw new Error("bad qty");
  return qty;
}
`,
      "cart.mjs": `function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}
export function validateCart(qty) {
  if (!isPositiveInt(qty)) throw new Error("bad qty");
  return qty;
}
`,
    },
    solution: {
      "validators.mjs": `export function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}
`,
      "order.mjs": `import { isPositiveInt } from "./validators.mjs";
export function validateOrder(qty) {
  if (!isPositiveInt(qty)) throw new Error("bad qty");
  return qty;
}
`,
      "cart.mjs": `import { isPositiveInt } from "./validators.mjs";
export function validateCart(qty) {
  if (!isPositiveInt(qty)) throw new Error("bad qty");
  return qty;
}
`,
    },
    testBody: `
  import { validateOrder } from "./order.mjs";
  import { validateCart } from "./cart.mjs";
  import { readFileSync } from "node:fs";
  import { fileURLToPath } from "node:url";
  import path from "node:path";
  assert.equal(validateOrder(2), 2);
  assert.equal(validateCart(3), 3);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const orderSrc = readFileSync(path.join(here, "order.mjs"), "utf8");
  const cartSrc = readFileSync(path.join(here, "cart.mjs"), "utf8");
  assert.ok(!orderSrc.includes("function isPositiveInt"));
  assert.ok(!cartSrc.includes("function isPositiveInt"));
`,
  }),

  multiFileTask({
    id: "test-fix-async-flaky",
    title: "Fix flaky async test timing",
    source: ds("fix-flaky-async-test"),
    category: "test",
    prompt:
      "timer.test.mjs fails intermittently because it uses real timers. Fix timer.test.mjs only so it awaits deterministically.",
    files: {
      "timer.mjs": `export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
`,
      "timer.test.mjs": `import assert from "node:assert/strict";
import { delay } from "./timer.mjs";
delay(1000).then(() => {
  assert.ok(true);
  console.log("timer test ok");
});
// exits before timer fires — treated as failure
assert.fail("must await delay()");
`,
    },
    solution: {
      "timer.test.mjs": `import assert from "node:assert/strict";
import { delay } from "./timer.mjs";
await delay(5);
assert.ok(true);
console.log("timer test ok");
`,
    },
    testBody: `
  import { execFileSync } from "node:child_process";
  import { fileURLToPath } from "node:url";
  import path from "node:path";
  const here = path.dirname(fileURLToPath(import.meta.url));
  execFileSync(process.execPath, ["timer.test.mjs"], { cwd: here, stdio: "pipe" });
`,
  }),

  multiFileTask({
    id: "test-fix-mock-order",
    title: "Fix mock call order assertion",
    source: ds("fix-mock-order-test"),
    category: "test",
    prompt:
      "logger.test.mjs expects the wrong call order. Fix the test to match logger.mjs behavior (warn before info).",
    files: {
      "logger.mjs": `export function logSequence(fn) {
  fn("warn", "setup");
  fn("info", "ready");
}
`,
      "logger.test.mjs": `import assert from "node:assert/strict";
import { logSequence } from "./logger.mjs";
const calls = [];
logSequence((level, msg) => calls.push([level, msg]));
assert.deepEqual(calls, [["info", "ready"], ["warn", "setup"]]);
console.log("logger test ok");
`,
    },
    solution: {
      "logger.test.mjs": `import assert from "node:assert/strict";
import { logSequence } from "./logger.mjs";
const calls = [];
logSequence((level, msg) => calls.push([level, msg]));
assert.deepEqual(calls, [["warn", "setup"], ["info", "ready"]]);
console.log("logger test ok");
`,
    },
    testBody: `
  import { execFileSync } from "node:child_process";
  import { fileURLToPath } from "node:url";
  import path from "node:path";
  const here = path.dirname(fileURLToPath(import.meta.url));
  execFileSync(process.execPath, ["logger.test.mjs"], { cwd: here, stdio: "pipe" });
`,
  }),

  singleModuleTask({
    id: "implement-observable-subscribe",
    title: "Minimal observable pub/sub",
    source: ds("observable-subscribe"),
    category: "feature",
    prompt: "Observable in observable.mjs supports subscribe(fn) and emit(value); unsubscribe removes listener.",
    module: "observable.mjs",
    broken: `export class Observable {
  subscribe(fn) {
    throw new Error("not implemented");
  }
  emit(value) {
    throw new Error("not implemented");
  }
}
`,
    fixed: `export class Observable {
  constructor() {
    this.subs = new Set();
  }
  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  emit(value) {
    for (const fn of this.subs) fn(value);
  }
}
`,
    testBody: `
  import { Observable } from "./observable.mjs";
  const obs = new Observable();
  let seen = 0;
  const off = obs.subscribe((v) => { seen = v; });
  obs.emit(5);
  assert.equal(seen, 5);
  off();
  obs.emit(9);
  assert.equal(seen, 5);
`,
  }),

  singleModuleTask({
    id: "fix-encoding-utf8",
    title: "Normalize to NFC before compare",
    source: ds("utf8-normalization-fix"),
    category: "bugfix",
    prompt: "sameText(a,b) in text.mjs compares Unicode strings after NFC normalization.",
    module: "text.mjs",
    broken: `export function sameText(a, b) {
  return a === b;
}
`,
    fixed: `export function sameText(a, b) {
  return a.normalize("NFC") === b.normalize("NFC");
}
`,
    testBody: `
  import { sameText } from "./text.mjs";
  const a = "caf\\u00e9";
  const b = "cafe\\u0301";
  assert.equal(a === b, false);
  assert.equal(sameText(a, b), true);
`,
  }),

  singleModuleTask({
    id: "add-error-boundary-wrapper",
    title: "Catch errors and map to result type",
    source: ds("error-boundary-wrapper"),
    category: "feature",
    prompt: "safeRun(fn) in safe.mjs returns { ok: true, value } or { ok: false, error } without throwing.",
    module: "safe.mjs",
    broken: `export async function safeRun(fn) {
  return { ok: true, value: await fn() };
}
`,
    fixed: `export async function safeRun(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}
`,
    testBody: `
  import { safeRun } from "./safe.mjs";
  const ok = await safeRun(async () => 1);
  const bad = await safeRun(async () => { throw new Error("x"); });
  assert.equal(ok.ok, true);
  assert.equal(bad.ok, false);
`,
  }),

  singleModuleTask({
    id: "implement-ring-buffer",
    title: "Fixed-size ring buffer overwrite",
    source: ds("ring-buffer-capricorn86"),
    category: "feature",
    prompt: "RingBuffer in ring.mjs overwrites oldest item when pushing beyond capacity.",
    module: "ring.mjs",
    broken: `export class RingBuffer {
  constructor(capacity) {
    throw new Error("not implemented");
  }
}
`,
    fixed: `export class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buf = [];
    this.i = 0;
  }
  push(item) {
    if (this.buf.length < this.capacity) {
      this.buf.push(item);
      return;
    }
    this.buf[this.i] = item;
    this.i = (this.i + 1) % this.capacity;
  }
  toArray() {
    if (this.buf.length < this.capacity) return [...this.buf];
    return [...this.buf.slice(this.i), ...this.buf.slice(0, this.i)];
  }
}
`,
    testBody: `
  import { RingBuffer } from "./ring.mjs";
  const r = new RingBuffer(3);
  r.push(1); r.push(2); r.push(3); r.push(4);
  assert.deepEqual(r.toArray(), [2, 3, 4]);
`,
  }),

  singleModuleTask({
    id: "add-idempotency-key",
    title: "Dedupe operations by idempotency key",
    source: ds("idempotency-key-store"),
    category: "feature",
    prompt: "IdempotencyStore in idem.mjs runs handler once per key and returns cached result on repeats.",
    module: "idem.mjs",
    broken: `export class IdempotencyStore {
  async run(key, handler) {
    return handler();
  }
}
`,
    fixed: `export class IdempotencyStore {
  constructor() {
    this.cache = new Map();
  }
  async run(key, handler) {
    if (this.cache.has(key)) return this.cache.get(key);
    const p = Promise.resolve().then(handler);
    this.cache.set(key, p);
    return p;
  }
}
`,
    testBody: `
  import { IdempotencyStore } from "./idem.mjs";
  const store = new IdempotencyStore();
  let n = 0;
  const fn = async () => { n++; return "ok"; };
  assert.equal(await store.run("k", fn), "ok");
  assert.equal(await store.run("k", fn), "ok");
  assert.equal(n, 1);
`,
  }),
];
