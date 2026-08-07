/**
 * Terminal-Bench 2.1 inspired tasks adapted to Node.js fixtures.
 */

import { multiFileTask, singleModuleTask, specAndTestTask } from "./builders.js";
import type { CatalogTask } from "./types.js";

const tb = (taskId: string) =>
  ({ benchmark: "terminal-bench" as const, taskId });

export const terminalBenchTasks: CatalogTask[] = [
  singleModuleTask({
    id: "cancel-async-tasks",
    title: "Fix cooperative task cancellation",
    source: tb("cancel-async-tasks"),
    category: "bugfix",
    prompt:
      "TaskRunner in runner.mjs should honor AbortSignal: when aborted, pending work stops and run() rejects with AbortError. Currently it ignores the signal. Fix runner.mjs only.",
    module: "runner.mjs",
    broken: `export class TaskRunner {
  constructor() {
    this._queue = Promise.resolve();
  }
  run(fn, { signal } = {}) {
    const job = async () => fn();
    this._queue = this._queue.then(job, job);
    return this._queue;
  }
}
`,
    fixed: `export class TaskRunner {
  constructor() {
    this._queue = Promise.resolve();
  }
  run(fn, { signal } = {}) {
    const job = () => {
      if (signal?.aborted) {
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      }
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", onAbort, { once: true });
        Promise.resolve(fn()).then(resolve, reject).finally(() => {
          signal?.removeEventListener("abort", onAbort);
        });
      });
    };
    this._queue = this._queue.then(job, job);
    return this._queue;
  }
}
`,
    testBody: `
  import { TaskRunner } from "./runner.mjs";
  const runner = new TaskRunner();
  const ctrl = new AbortController();
  let settled = false;
  let release;
  const entered = new Promise((r) => { release = r; });
  const slow = runner.run(async () => {
    release();
    await new Promise((r) => setTimeout(r, 50));
    settled = true;
    return "done";
  }, { signal: ctrl.signal });
  await entered;
  ctrl.abort();
  await assert.rejects(() => slow, (e) => e.name === "AbortError");
  assert.equal(settled, false);
`,
  }),

  singleModuleTask({
    id: "sanitize-html",
    title: "Strip script tags and event handlers from HTML",
    source: tb("filter-js-from-html"),
    category: "feature",
    prompt:
      "Implement sanitizeHtml(html) in sanitize.mjs. Remove <script> blocks, on* attributes, and javascript: URLs. Keep safe text and tags.",
    module: "sanitize.mjs",
    broken: `export function sanitizeHtml(html) {
  return html;
}
`,
    fixed: `export function sanitizeHtml(html) {
  let out = html.replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, "");
  out = out.replace(/\\son[a-z]+\\s*=\\s*(['"])[^'"]*\\1/gi, "");
  out = out.replace(/\\shref\\s*=\\s*(['"])javascript:[^'"]*\\1/gi, "");
  return out;
}
`,
    testBody: `
  import { sanitizeHtml } from "./sanitize.mjs";
  const dirty = '<p onclick="alert(1)">hi<script>evil()</script></p><a href="javascript:alert(1)">x</a>';
  const clean = sanitizeHtml(dirty);
  assert.ok(!clean.includes("<script"));
  assert.ok(!clean.includes("onclick"));
  assert.ok(!clean.includes("javascript:"));
  assert.ok(clean.includes("<p>hi</p>"));
`,
  }),

  singleModuleTask({
    id: "fix-path-traversal",
    title: "Block path traversal in safeJoin",
    source: tb("fix-code-vulnerability"),
    category: "bugfix",
    prompt:
      "safeJoin(root, userPath) in paths.mjs must resolve paths under root only. The current join allows ../ escape. Fix it.",
    module: "paths.mjs",
    broken: `import path from "node:path";

export function safeJoin(root, userPath) {
  return path.join(root, userPath);
}
`,
    fixed: `import path from "node:path";

export function safeJoin(root, userPath) {
  const resolved = path.resolve(root, userPath);
  const normalizedRoot = path.resolve(root);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error("path traversal");
  }
  return resolved;
}
`,
    testBody: `
  import { safeJoin } from "./paths.mjs";
  import path from "node:path";
  import { fileURLToPath } from "node:url";
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "data-root");
  assert.equal(safeJoin(root, "logs/a.txt"), path.resolve(root, "logs/a.txt"));
  assert.throws(() => safeJoin(root, "../outside.txt"));
`,
  }),

  singleModuleTask({
    id: "parse-shell-command",
    title: "Tokenize a simple shell command line",
    source: tb("headless-terminal"),
    category: "feature",
    prompt:
      "Implement tokenize(command) in shell.mjs: split on whitespace but respect single and double quotes.",
    module: "shell.mjs",
    broken: `export function tokenize(command) {
  return command.split(/\\s+/).filter(Boolean);
}
`,
    fixed: `export function tokenize(command) {
  const tokens = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}
`,
    testBody: `
  import { tokenize } from "./shell.mjs";
  assert.deepEqual(tokenize('echo "hello world"'), ["echo", "hello world"]);
  assert.deepEqual(tokenize("ls -la '/tmp/a b'"), ["ls", "-la", "/tmp/a b"]);
`,
  }),

  singleModuleTask({
    id: "implement-kv-store",
    title: "Implement in-memory KV store with TTL",
    source: tb("kv-store-grpc"),
    category: "feature",
    prompt:
      "Implement KVStore in kv.mjs with set(key,val,ttlMs?), get(key), delete(key). Expired keys behave as missing.",
    module: "kv.mjs",
    broken: `export class KVStore {
  set() {
    throw new Error("not implemented");
  }
  get() {
    throw new Error("not implemented");
  }
  delete() {
    throw new Error("not implemented");
  }
}
`,
    fixed: `export class KVStore {
  constructor() {
    this._map = new Map();
  }
  set(key, value, ttlMs) {
    const expiresAt = ttlMs != null ? Date.now() + ttlMs : null;
    this._map.set(key, { value, expiresAt });
  }
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt != null && Date.now() >= entry.expiresAt) {
      this._map.delete(key);
      return undefined;
    }
    return entry.value;
  }
  delete(key) {
    return this._map.delete(key);
  }
}
`,
    testBody: `
  import { KVStore } from "./kv.mjs";
  const kv = new KVStore();
  kv.set("a", 1);
  assert.equal(kv.get("a"), 1);
  kv.set("b", 2, 30);
  assert.equal(kv.get("b"), 2);
  kv.delete("a");
  assert.equal(kv.get("a"), undefined);
`,
  }),

  singleModuleTask({
    id: "resolve-merge-markers",
    title: "Resolve git conflict markers in a file",
    source: tb("merge-diff-arc-agi-task"),
    category: "bugfix",
    prompt:
      "resolveConflict(text) in merge.mjs must keep the incoming side (between ======= and >>>>>>>) and drop markers.",
    module: "merge.mjs",
    broken: `export function resolveConflict(text) {
  return text;
}
`,
    fixed: `export function resolveConflict(text) {
  const re = /<<<<<<<[^\\n]*\\n([\\s\\S]*?)=======\\n([\\s\\S]*?)>>>>>>>[^\\n]*\\n?/g;
  return text.replace(re, (_, _ours, theirs) => theirs);
}
`,
    testBody: `
  import { resolveConflict } from "./merge.mjs";
  const input = "a\\n<<<<<<< HEAD\\nours\\n=======\\ntheirs\\n>>>>>>> branch\\nb";
  assert.equal(resolveConflict(input), "a\\ntheirs\\nb");
`,
  }),

  singleModuleTask({
    id: "port-fixed-width-records",
    title: "Parse fixed-width records to objects",
    source: tb("cobol-modernization"),
    category: "feature",
    prompt:
      "parseRecords(lines) in records.mjs parses 20-char id + 30-char name fixed-width lines into {id,name}.",
    module: "records.mjs",
    broken: `export function parseRecords(lines) {
  return lines.map((line) => ({ raw: line }));
}
`,
    fixed: `export function parseRecords(lines) {
  return lines.map((line) => ({
    id: line.slice(0, 20).trimEnd(),
    name: line.slice(20, 50).trimEnd(),
  }));
}
`,
    testBody: `
  import { parseRecords } from "./records.mjs";
  const line = "001".padEnd(20, " ") + "Ada Lovelace".padEnd(30, " ");
  const rows = parseRecords([line]);
  assert.deepEqual(rows, [{ id: "001", name: "Ada Lovelace" }]);
`,
  }),

  singleModuleTask({
    id: "reshard-jsonl",
    title: "Split JSONL into N balanced shard files",
    source: tb("reshard-c4-data"),
    category: "feature",
    prompt:
      "reshard(lines, shardCount) in reshard.mjs returns an array of shard arrays with nearly equal sizes.",
    module: "reshard.mjs",
    broken: `export function reshard(lines, shardCount) {
  return [lines];
}
`,
    fixed: `export function reshard(lines, shardCount) {
  const shards = Array.from({ length: shardCount }, () => []);
  for (let i = 0; i < lines.length; i++) {
    shards[i % shardCount].push(lines[i]);
  }
  return shards;
}
`,
    testBody: `
  import { reshard } from "./reshard.mjs";
  const lines = ["a","b","c","d","e"];
  const shards = reshard(lines, 2);
  assert.deepEqual(shards, [["a","c","e"], ["b","d"]]);
`,
  }),

  singleModuleTask({
    id: "promisify-callback-api",
    title: "Promisify callback-style readConfig",
    source: tb("modernize-scientific-stack"),
    category: "refactor",
    prompt:
      "Add readConfigAsync(path) to config.mjs that wraps the existing callback readConfig without breaking it.",
    module: "config.mjs",
    broken: `import fs from "node:fs";

export function readConfig(path, cb) {
  fs.readFile(path, "utf8", (err, text) => {
    if (err) return cb(err);
    cb(null, JSON.parse(text));
  });
}
`,
    fixed: `import fs from "node:fs";

export function readConfig(path, cb) {
  fs.readFile(path, "utf8", (err, text) => {
    if (err) return cb(err);
    cb(null, JSON.parse(text));
  });
}

export function readConfigAsync(path) {
  return new Promise((resolve, reject) => {
    readConfig(path, (err, cfg) => (err ? reject(err) : resolve(cfg)));
  });
}
`,
    testBody: `
  import fs from "node:fs/promises";
  import path from "node:path";
  import { fileURLToPath } from "node:url";
  import { readConfigAsync } from "./config.mjs";
  const here = path.dirname(fileURLToPath(import.meta.url));
  const p = path.join(here, "sample.json");
  await fs.writeFile(p, '{"ok":true}');
  const cfg = await readConfigAsync(p);
  assert.deepEqual(cfg, { ok: true });
  await fs.unlink(p);
`,
  }),

  singleModuleTask({
    id: "recover-deleted-artifact",
    title: "Recover latest backup artifact by timestamp",
    source: tb("fix-git"),
    category: "bugfix",
    prompt:
      "recoverLatest(backups) in recover.mjs returns the backup object with the greatest ts field.",
    module: "recover.mjs",
    broken: `export function recoverLatest(backups) {
  return backups[0];
}
`,
    fixed: `export function recoverLatest(backups) {
  return backups.reduce((best, cur) => (cur.ts > best.ts ? cur : best));
}
`,
    testBody: `
  import { recoverLatest } from "./recover.mjs";
  const backups = [{ ts: 1, data: "a" }, { ts: 3, data: "c" }, { ts: 2, data: "b" }];
  assert.deepEqual(recoverLatest(backups), { ts: 3, data: "c" });
`,
  }),

  singleModuleTask({
    id: "scrub-secrets-log",
    title: "Redact API keys from log lines",
    source: tb("git-leak-recovery"),
    category: "bugfix",
    prompt:
      "scrubSecrets(text) in scrub.mjs replaces sk-... and AKIA... patterns with [REDACTED].",
    module: "scrub.mjs",
    broken: `export function scrubSecrets(text) {
  return text;
}
`,
    fixed: `export function scrubSecrets(text) {
  return text
    .replace(/sk-[A-Za-z0-9]{8,}/g, "[REDACTED]")
    .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]");
}
`,
    testBody: `
  import { scrubSecrets } from "./scrub.mjs";
  const line = "key=sk-abc1234567890 token=AKIAIOSFODNN7EXAMPLE";
  const out = scrubSecrets(line);
  assert.ok(!out.includes("sk-abc"));
  assert.ok(!out.includes("AKIAIOSFODNN7EXAMPLE"));
  assert.ok(out.includes("[REDACTED]"));
`,
  }),

  singleModuleTask({
    id: "implement-retry-backoff",
    title: "Retry async fn with exponential backoff",
    source: tb("cancel-async-tasks"),
    category: "feature",
    prompt:
      "retry(fn, { retries, baseMs }) in retry.mjs retries transient failures with exponential backoff.",
    module: "retry.mjs",
    broken: `export async function retry(fn) {
  return fn();
}
`,
    fixed: `export async function retry(fn, { retries = 3, baseMs = 10 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** attempt));
    }
  }
  throw lastErr;
}
`,
    testBody: `
  import { retry } from "./retry.mjs";
  let n = 0;
  const val = await retry(async () => {
    n++;
    if (n < 3) throw new Error("fail");
    return 42;
  }, { retries: 5, baseMs: 1 });
  assert.equal(val, 42);
  assert.equal(n, 3);
`,
  }),

  singleModuleTask({
    id: "implement-token-bucket",
    title: "Implement token bucket rate limiter",
    source: tb("pypi-server"),
    category: "feature",
    prompt:
      "TokenBucket in bucket.mjs refills tokens over time and consume(n) throws when insufficient.",
    module: "bucket.mjs",
    broken: `export class TokenBucket {
  constructor() {
    throw new Error("not implemented");
  }
}
`,
    fixed: `export class TokenBucket {
  constructor({ capacity, refillPerMs }) {
    this.capacity = capacity;
    this.refillPerMs = refillPerMs;
    this.tokens = capacity;
    this._last = Date.now();
  }
  _refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this._last) * this.refillPerMs);
    this._last = now;
  }
  consume(n) {
    this._refill();
    if (this.tokens < n) throw new Error("rate limited");
    this.tokens -= n;
  }
}
`,
    testBody: `
  import { TokenBucket } from "./bucket.mjs";
  const b = new TokenBucket({ capacity: 2, refillPerMs: 0 });
  b.consume(1);
  b.consume(1);
  assert.throws(() => b.consume(1));
`,
  }),

  singleModuleTask({
    id: "parse-dotenv",
    title: "Parse dotenv text into key/value map",
    source: tb("modernize-scientific-stack"),
    category: "feature",
    prompt: "parseDotenv(text) in dotenv.mjs parses KEY=VALUE lines, ignoring blanks and # comments.",
    module: "dotenv.mjs",
    broken: `export function parseDotenv(text) {
  return {};
}
`,
    fixed: `export function parseDotenv(text) {
  const out = {};
  for (const line of text.split(/\\r?\\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}
`,
    testBody: `
  import { parseDotenv } from "./dotenv.mjs";
  const text = "# comment\\nFOO=bar\\nBAZ=\\"quoted\\"\\n";
  assert.deepEqual(parseDotenv(text), { FOO: "bar", BAZ: "quoted" });
`,
  }),

  singleModuleTask({
    id: "implement-glob-matcher",
    title: "Match simple glob patterns",
    source: tb("polyglot-c-py"),
    category: "feature",
    prompt: "globMatch(pattern, path) in glob.mjs supports * and ** wildcards.",
    module: "glob.mjs",
    broken: `export function globMatch(pattern, path) {
  return pattern === path;
}
`,
    fixed: `export function globMatch(pattern, path) {
  const esc = pattern.replace(/[.+^\${}()|[\\]\\\\]/g, "\\\\$&");
  const re = esc.replace(/\\*\\*/g, ".*").replace(/\\*/g, "[^/]*");
  return new RegExp("^" + re + "$").test(path);
}
`,
    testBody: `
  import { globMatch } from "./glob.mjs";
  assert.equal(globMatch("src/**/*.js", "src/a/b.js"), true);
  assert.equal(globMatch("*.txt", "a.txt"), true);
  assert.equal(globMatch("*.txt", "a.md"), false);
`,
  }),

  singleModuleTask({
    id: "local-package-index",
    title: "Resolve package name to tarball path",
    source: tb("pypi-server"),
    category: "feature",
    prompt:
      "PackageIndex.resolve(name, version) in index.mjs looks up packages in a manifest map.",
    module: "index.mjs",
    broken: `export class PackageIndex {
  constructor(manifest) {
    this.manifest = manifest;
  }
  resolve(name, version) {
    return null;
  }
}
`,
    fixed: `export class PackageIndex {
  constructor(manifest) {
    this.manifest = manifest;
  }
  resolve(name, version) {
    const pkg = this.manifest[name];
    if (!pkg) return null;
    const path = pkg.versions[version];
    return path ?? null;
  }
}
`,
    testBody: `
  import { PackageIndex } from "./index.mjs";
  const idx = new PackageIndex({ lodash: { versions: { "4.17.21": "/pkgs/lodash-4.17.21.tgz" } } });
  assert.equal(idx.resolve("lodash", "4.17.21"), "/pkgs/lodash-4.17.21.tgz");
  assert.equal(idx.resolve("lodash", "1.0.0"), null);
`,
  }),

  singleModuleTask({
    id: "optimize-lookup-index",
    title: "Add index map for O(1) user lookup",
    source: tb("query-optimize"),
    category: "refactor",
    prompt:
      "UserDirectory in users.mjs must build an id→user map on construction so findById is O(1).",
    module: "users.mjs",
    broken: `export class UserDirectory {
  constructor(users) {
    this.users = users;
  }
  findById(id) {
    return this.users.find((u) => u.id === id);
  }
}
`,
    fixed: `export class UserDirectory {
  constructor(users) {
    this.users = users;
    this._byId = new Map(users.map((u) => [u.id, u]));
  }
  findById(id) {
    return this._byId.get(id);
  }
}
`,
    testBody: `
  import { UserDirectory } from "./users.mjs";
  import { readFileSync } from "node:fs";
  import { fileURLToPath } from "node:url";
  import path from "node:path";
  const dir = new UserDirectory([{ id: "1", name: "a" }, { id: "2", name: "b" }]);
  assert.equal(dir.findById("2").name, "b");
  assert.equal(dir.findById("9"), undefined);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "users.mjs"), "utf8");
  assert.ok(src.includes("new Map"));
  assert.ok(!src.includes(".find("));
`,
  }),

  multiFileTask({
    id: "fix-circular-import",
    title: "Break circular dependency between a and b modules",
    source: tb("merge-diff-arc-agi-task"),
    category: "bugfix",
    prompt:
      "a.mjs and b.mjs have a circular import causing undefined exports. Restructure so both exports work.",
    files: {
      "a.mjs": `import { bValue } from "./b.mjs";
export const aValue = () => \`a:\${bValue()}\`;
`,
      "b.mjs": `import { aValue } from "./a.mjs";
export const bValue = () => \`b:\${typeof aValue}\`;
`,
    },
    solution: {
      "a.mjs": `export const aValue = () => "a:ok";
`,
      "b.mjs": `export const bValue = () => "b:ok";
`,
    },
    testBody: `
  import { aValue } from "./a.mjs";
  import { bValue } from "./b.mjs";
  assert.equal(aValue(), "a:ok");
  assert.equal(bValue(), "b:ok");
`,
  }),

  singleModuleTask({
    id: "fix-event-listener-leak",
    title: "Remove listeners on unsubscribe",
    source: tb("headless-terminal"),
    category: "bugfix",
    prompt: "EventBus.off(event, fn) in bus.mjs must remove the listener registered by on().",
    module: "bus.mjs",
    broken: `export class EventBus {
  constructor() {
    this._events = new Map();
  }
  on(event, fn) {
    if (!this._events.has(event)) this._events.set(event, new Set());
    this._events.get(event).add(fn);
  }
  off(event, fn) {
    // bug: no-op
  }
  emit(event, payload) {
    for (const fn of this._events.get(event) ?? []) fn(payload);
  }
}
`,
    fixed: `export class EventBus {
  constructor() {
    this._events = new Map();
  }
  on(event, fn) {
    if (!this._events.has(event)) this._events.set(event, new Set());
    this._events.get(event).add(fn);
  }
  off(event, fn) {
    this._events.get(event)?.delete(fn);
  }
  emit(event, payload) {
    for (const fn of this._events.get(event) ?? []) fn(payload);
  }
}
`,
    testBody: `
  import { EventBus } from "./bus.mjs";
  const bus = new EventBus();
  let n = 0;
  const fn = () => n++;
  bus.on("x", fn);
  bus.emit("x");
  bus.off("x", fn);
  bus.emit("x");
  assert.equal(n, 1);
`,
  }),

  singleModuleTask({
    id: "fix-json-trailing-comma",
    title: "Reject JSON with trailing commas",
    source: tb("fix-code-vulnerability"),
    category: "bugfix",
    prompt:
      "parseStrictJson(text) in json.mjs must throw on trailing commas before property/end.",
    module: "json.mjs",
    broken: `export function parseStrictJson(text) {
  return JSON.parse(text.replace(/,(\\s*[}\\]])/g, "$1"));
}
`,
    fixed: `export function parseStrictJson(text) {
  if (/,(\\s*[}\\]])/.test(text)) {
    throw new SyntaxError("trailing comma");
  }
  return JSON.parse(text);
}
`,
    testBody: `
  import { parseStrictJson } from "./json.mjs";
  assert.deepEqual(parseStrictJson('{"a":1}'), { a: 1 });
  assert.throws(() => parseStrictJson('{"a":1,}'));
`,
  }),

  singleModuleTask({
    id: "fix-deep-merge-mutation",
    title: "Deep merge without mutating inputs",
    source: tb("merge-diff-arc-agi-task"),
    category: "bugfix",
    prompt: "deepMerge(a,b) in merge-deep.mjs must return a new object and not mutate a or b.",
    module: "merge-deep.mjs",
    broken: `export function deepMerge(a, b) {
  for (const k of Object.keys(b)) {
    a[k] = b[k];
  }
  return a;
}
`,
    fixed: `export function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    const av = a[k];
    const bv = b[k];
    out[k] =
      av && bv && typeof av === "object" && typeof bv === "object" && !Array.isArray(av)
        ? deepMerge(av, bv)
        : bv;
  }
  return out;
}
`,
    testBody: `
  import { deepMerge } from "./merge-deep.mjs";
  const a = { x: { y: 1 }, z: 1 };
  const b = { x: { w: 2 }, z: 2 };
  const m = deepMerge(a, b);
  assert.deepEqual(m, { x: { y: 1, w: 2 }, z: 2 });
  assert.deepEqual(a, { x: { y: 1 }, z: 1 });
`,
  }),

  specAndTestTask({
    id: "implement-semver-compare",
    title: "Compare semver strings",
    source: tb("pypi-server"),
    category: "feature",
    prompt: "Implement compareSemver(a,b) in semver.mjs per SPEC.md.",
    module: "semver.mjs",
    stub: `export function compareSemver(a, b) {
  throw new Error("not implemented");
}
`,
    fixed: `export function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
`,
    spec: `# semver compare\nReturn -1 if a<b, 0 if equal, 1 if a>b. Compare major.minor.patch numerically.`,
    testFile: "semver.test.mjs",
    testContent: `import assert from "node:assert/strict";
import { compareSemver } from "./semver.mjs";
assert.equal(compareSemver("1.2.3", "1.2.4"), -1);
assert.equal(compareSemver("2.0.0", "1.9.9"), 1);
assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
console.log("semver tests ok");
`,
  }),

  singleModuleTask({
    id: "fix-sql-injection-pattern",
    title: "Use parameterized query builder",
    source: tb("fix-code-vulnerability"),
    category: "bugfix",
    prompt:
      "buildQuery(table, id) in query.mjs must use placeholders, never interpolate raw id.",
    module: "query.mjs",
    broken: `export function buildQuery(table, id) {
  return { sql: \`SELECT * FROM \${table} WHERE id = '\${id}'\`, params: [] };
}
`,
    fixed: `export function buildQuery(table, id) {
  return { sql: \`SELECT * FROM \${table} WHERE id = ?\`, params: [id] };
}
`,
    testBody: `
  import { buildQuery } from "./query.mjs";
  const q = buildQuery("users", "1; DROP TABLE users");
  assert.ok(!q.sql.includes("DROP"));
  assert.deepEqual(q.params, ["1; DROP TABLE users"]);
`,
  }),

  singleModuleTask({
    id: "fix-race-counter",
    title: "Fix lost increment in async counter",
    source: tb("cancel-async-tasks"),
    category: "bugfix",
    prompt: "AsyncCounter.increment() in counter.mjs loses updates under concurrency. Serialize updates.",
    module: "counter.mjs",
    broken: `export class AsyncCounter {
  constructor() {
    this.value = 0;
  }
  async increment() {
    const cur = this.value;
    await Promise.resolve();
    this.value = cur + 1;
    return this.value;
  }
}
`,
    fixed: `export class AsyncCounter {
  constructor() {
    this.value = 0;
    this._chain = Promise.resolve();
  }
  increment() {
    this._chain = this._chain.then(async () => {
      this.value += 1;
      return this.value;
    });
    return this._chain;
  }
}
`,
    testBody: `
  import { AsyncCounter } from "./counter.mjs";
  const c = new AsyncCounter();
  await Promise.all([c.increment(), c.increment(), c.increment()]);
  assert.equal(c.value, 3);
`,
  }),

  singleModuleTask({
    id: "fix-buffer-encoding",
    title: "Compare UTF-8 strings safely",
    source: tb("polyglot-c-py"),
    category: "bugfix",
    prompt: "equalUtf8(a,b) in encoding.mjs compares strings by UTF-8 bytes, not reference.",
    module: "encoding.mjs",
    broken: `export function equalUtf8(a, b) {
  return a === b;
}
`,
    fixed: `export function equalUtf8(a, b) {
  return Buffer.from(a.normalize("NFC"), "utf8").equals(Buffer.from(b.normalize("NFC"), "utf8"));
}
`,
    testBody: `
  import { equalUtf8 } from "./encoding.mjs";
  const a = "caf\\u00e9";
  const b = "cafe\\u0301";
  assert.equal(a === b, false);
  assert.equal(equalUtf8(a, b), true);
`,
  }),

  singleModuleTask({
    id: "fix-timezone-date-only",
    title: "Parse YYYY-MM-DD as UTC midnight",
    source: tb("modernize-scientific-stack"),
    category: "bugfix",
    prompt: "parseDateOnly(s) in dates.mjs must interpret date-only strings as UTC, not local.",
    module: "dates.mjs",
    broken: `export function parseDateOnly(s) {
  return new Date(s + "T00:00:00");
}
`,
    fixed: `export function parseDateOnly(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
`,
    testBody: `
  import { parseDateOnly } from "./dates.mjs";
  const dt = parseDateOnly("2024-06-15");
  assert.equal(dt.toISOString(), "2024-06-15T00:00:00.000Z");
`,
  }),

  singleModuleTask({
    id: "fix-unhandled-promise",
    title: "Surface rejection from fire-and-forget helper",
    source: tb("cancel-async-tasks"),
    category: "bugfix",
    prompt:
      "runTracked(promise, onError) in track.mjs must call onError when promise rejects.",
    module: "track.mjs",
    broken: `export function runTracked(promise, onError) {
  promise.then(() => {});
}
`,
    fixed: `export function runTracked(promise, onError) {
  promise.catch(onError);
}
`,
    testBody: `
  import { runTracked } from "./track.mjs";
  let seen = null;
  runTracked(Promise.reject(new Error("boom")), (e) => {
    seen = e.message;
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(seen, "boom");
`,
  }),

  singleModuleTask({
    id: "implement-lru-cache",
    title: "Implement LRU cache with capacity",
    source: tb("kv-store-grpc"),
    category: "feature",
    prompt: "LRUCache in lru.mjs evicts least-recently-used entry when capacity exceeded.",
    module: "lru.mjs",
    broken: `export class LRUCache {
  constructor(capacity) {
    throw new Error("not implemented");
  }
}
`,
    fixed: `export class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
  }
}
`,
    testBody: `
  import { LRUCache } from "./lru.mjs";
  const lru = new LRUCache(2);
  lru.set("a", 1);
  lru.set("b", 2);
  lru.get("a");
  lru.set("c", 3);
  assert.equal(lru.get("b"), undefined);
  assert.equal(lru.get("a"), 1);
`,
  }),

  singleModuleTask({
    id: "implement-min-heap",
    title: "Implement min-heap priority queue",
    source: tb("query-optimize"),
    category: "feature",
    prompt: "MinHeap in heap.mjs supports push(n) and pop() returning smallest element.",
    module: "heap.mjs",
    broken: `export class MinHeap {
  push() {
    throw new Error("not implemented");
  }
  pop() {
    throw new Error("not implemented");
  }
}
`,
    fixed: `export class MinHeap {
  constructor() {
    this.a = [];
  }
  push(n) {
    this.a.push(n);
    this._up(this.a.length - 1);
  }
  pop() {
    if (!this.a.length) return undefined;
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      this._down(0);
    }
    return top;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p] <= this.a[i]) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  _down(i) {
    for (;;) {
      let s = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < this.a.length && this.a[l] < this.a[s]) s = l;
      if (r < this.a.length && this.a[r] < this.a[s]) s = r;
      if (s === i) break;
      [this.a[s], this.a[i]] = [this.a[i], this.a[s]];
      i = s;
    }
  }
}
`,
    testBody: `
  import { MinHeap } from "./heap.mjs";
  const h = new MinHeap();
  h.push(3);
  h.push(1);
  h.push(2);
  assert.equal(h.pop(), 1);
  assert.equal(h.pop(), 2);
  assert.equal(h.pop(), 3);
`,
  }),

  singleModuleTask({
    id: "implement-topological-sort",
    title: "Topological sort of dependency graph",
    source: tb("merge-diff-arc-agi-task"),
    category: "feature",
    prompt: "topoSort(graph) in topo.mjs returns ordering where deps come before dependents.",
    module: "topo.mjs",
    broken: `export function topoSort(graph) {
  return Object.keys(graph);
}
`,
    fixed: `export function topoSort(graph) {
  const visited = new Set();
  const temp = new Set();
  const out = [];
  const visit = (n) => {
    if (visited.has(n)) return;
    if (temp.has(n)) throw new Error("cycle");
    temp.add(n);
    for (const dep of graph[n] ?? []) visit(dep);
    temp.delete(n);
    visited.add(n);
    out.push(n);
  };
  for (const n of Object.keys(graph)) visit(n);
  return out;
}
`,
    testBody: `
  import { topoSort } from "./topo.mjs";
  const order = topoSort({ app: ["db"], db: ["lib"], lib: [] });
  assert.ok(order.indexOf("lib") < order.indexOf("db"));
  assert.ok(order.indexOf("db") < order.indexOf("app"));
`,
  }),

  singleModuleTask({
    id: "fix-floating-epsilon",
    title: "Compare floats with epsilon tolerance",
    source: tb("modernize-scientific-stack"),
    category: "bugfix",
    prompt: "nearEqual(a,b,eps) in float.mjs compares with tolerance instead of ===.",
    module: "float.mjs",
    broken: `export function nearEqual(a, b, eps = 1e-9) {
  return a === b;
}
`,
    fixed: `export function nearEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}
`,
    testBody: `
  import { nearEqual } from "./float.mjs";
  assert.equal(nearEqual(0.1 + 0.2, 0.3, 1e-9), true);
  assert.equal(nearEqual(1, 2), false);
`,
  }),

  singleModuleTask({
    id: "fix-reducer-mutation",
    title: "Fix reducer mutating accumulator",
    source: tb("fix-code-vulnerability"),
    category: "bugfix",
    prompt: "totalByKey(items) in totals.mjs must not mutate the seed object across calls.",
    module: "totals.mjs",
    broken: `const seed = {};
export function totalByKey(items) {
  for (const { key, n } of items) {
    seed[key] = (seed[key] ?? 0) + n;
  }
  return seed;
}
`,
    fixed: `export function totalByKey(items) {
  const out = {};
  for (const { key, n } of items) {
    out[key] = (out[key] ?? 0) + n;
  }
  return out;
}
`,
    testBody: `
  import { totalByKey } from "./totals.mjs";
  assert.deepEqual(totalByKey([{ key: "a", n: 1 }]), { a: 1 });
  assert.deepEqual(totalByKey([{ key: "b", n: 2 }]), { b: 2 });
`,
  }),

  singleModuleTask({
    id: "fix-async-map-unbounded",
    title: "Limit concurrency in async map",
    source: tb("cancel-async-tasks"),
    category: "bugfix",
    prompt: "mapLimit(items, limit, fn) in pool.mjs runs at most `limit` tasks at once.",
    module: "pool.mjs",
    broken: `export async function mapLimit(items, limit, fn) {
  return Promise.all(items.map(fn));
}
`,
    fixed: `export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
`,
    testBody: `
  import { mapLimit } from "./pool.mjs";
  let running = 0;
  let max = 0;
  await mapLimit([1,2,3,4], 2, async () => {
    running++;
    max = Math.max(max, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
  });
  assert.ok(max <= 2);
`,
  }),

  singleModuleTask({
    id: "fix-middleware-order",
    title: "Run middleware in registration order",
    source: tb("headless-terminal"),
    category: "bugfix",
    prompt: "App.handle(req) in app.mjs must run middleware left-to-right.",
    module: "app.mjs",
    broken: `export class App {
  constructor() {
    this.middleware = [];
  }
  use(fn) {
    this.middleware.push(fn);
  }
  async handle(req) {
    for (let i = this.middleware.length - 1; i >= 0; i--) {
      await this.middleware[i](req);
    }
  }
}
`,
    fixed: `export class App {
  constructor() {
    this.middleware = [];
  }
  use(fn) {
    this.middleware.push(fn);
  }
  async handle(req) {
    for (const fn of this.middleware) {
      await fn(req);
    }
  }
}
`,
    testBody: `
  import { App } from "./app.mjs";
  const app = new App();
  const log = [];
  app.use(async () => log.push(1));
  app.use(async () => log.push(2));
  await app.handle({});
  assert.deepEqual(log, [1, 2]);
`,
  }),

  singleModuleTask({
    id: "fix-stale-closure",
    title: "Fix stale count in delayed callback",
    source: tb("cancel-async-tasks"),
    category: "bugfix",
    prompt: "Counter.makeDelayedIncrement(ms) in delayed.mjs must read latest count when timer fires.",
    module: "delayed.mjs",
    broken: `export class Counter {
  constructor() {
    this.count = 0;
  }
  makeDelayedIncrement(ms) {
    const snapshot = this.count;
    return () => {
      setTimeout(() => {
        this.count = snapshot + 1;
      }, ms);
    };
  }
}
`,
    fixed: `export class Counter {
  constructor() {
    this.count = 0;
  }
  makeDelayedIncrement(ms) {
    return () => {
      setTimeout(() => {
        this.count += 1;
      }, ms);
    };
  }
}
`,
    testBody: `
  import { Counter } from "./delayed.mjs";
  const c = new Counter();
  const inc = c.makeDelayedIncrement(5);
  inc();
  c.count = 5;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(c.count, 6);
`,
  }),

  singleModuleTask({
    id: "implement-deep-equal",
    title: "Deep equality for plain objects and arrays",
    source: tb("merge-diff-arc-agi-task"),
    category: "feature",
    prompt: "deepEqual(a,b) in equal.mjs compares nested structures recursively.",
    module: "equal.mjs",
    broken: `export function deepEqual(a, b) {
  return a === b;
}
`,
    fixed: `export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}
`,
    testBody: `
  import { deepEqual } from "./equal.mjs";
  assert.equal(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
`,
  }),

  singleModuleTask({
    id: "implement-pipeline",
    title: "Compose async middleware pipeline",
    source: tb("headless-terminal"),
    category: "feature",
    prompt: "pipeline(fns) in pipeline.mjs returns (input) reduced through fns left-to-right.",
    module: "pipeline.mjs",
    broken: `export function pipeline(fns) {
  return (input) => input;
}
`,
    fixed: `export function pipeline(fns) {
  return async (input) => {
    let cur = input;
    for (const fn of fns) {
      cur = await fn(cur);
    }
    return cur;
  };
}
`,
    testBody: `
  import { pipeline } from "./pipeline.mjs";
  const run = pipeline([
    async (x) => x + 1,
    async (x) => x * 2,
  ]);
  assert.equal(await run(3), 8);
`,
  }),

  singleModuleTask({
    id: "implement-bloom-filter",
    title: "Implement simple bloom filter",
    source: tb("query-optimize"),
    category: "feature",
    prompt: "BloomFilter in bloom.mjs supports add(value) and maybeHas(value) with no false negatives.",
    module: "bloom.mjs",
    broken: `export class BloomFilter {
  constructor(size) {
    throw new Error("not implemented");
  }
}
`,
    fixed: `export class BloomFilter {
  constructor(size = 1024) {
    this.bits = new Uint8Array(size);
    this.size = size;
  }
  _hash(s, seed) {
    let h = seed;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % this.size;
  }
  add(value) {
    for (const seed of [1, 7, 13]) this.bits[this._hash(String(value), seed)] = 1;
  }
  maybeHas(value) {
    for (const seed of [1, 7, 13]) {
      if (!this.bits[this._hash(String(value), seed)]) return false;
    }
    return true;
  }
}
`,
    testBody: `
  import { BloomFilter } from "./bloom.mjs";
  const bf = new BloomFilter(256);
  bf.add("hello");
  assert.equal(bf.maybeHas("hello"), true);
  assert.equal(bf.maybeHas("missing"), false);
`,
  }),

  singleModuleTask({
    id: "implement-trie-search",
    title: "Prefix search with trie",
    source: tb("query-optimize"),
    category: "feature",
    prompt: "Trie in trie.mjs supports insert(word) and startsWith(prefix).",
    module: "trie.mjs",
    broken: `export class Trie {
  insert() {
    throw new Error("not implemented");
  }
  startsWith() {
    throw new Error("not implemented");
  }
}
`,
    fixed: `export class Trie {
  constructor() {
    this.root = {};
  }
  insert(word) {
    let node = this.root;
    for (const ch of word) {
      node[ch] ??= {};
      node = node[ch];
    }
    node.$ = true;
  }
  startsWith(prefix) {
    let node = this.root;
    for (const ch of prefix) {
      if (!node[ch]) return false;
      node = node[ch];
    }
    return true;
  }
}
`,
    testBody: `
  import { Trie } from "./trie.mjs";
  const t = new Trie();
  t.insert("apple");
  t.insert("app");
  assert.equal(t.startsWith("ap"), true);
  assert.equal(t.startsWith("ban"), false);
`,
  }),

  singleModuleTask({
    id: "fix-stack-overflow-dfs",
    title: "Convert recursive DFS to iterative",
    source: tb("fix-code-vulnerability"),
    category: "bugfix",
    prompt: "walkTree(node, visit) in walk.mjs must traverse without recursive stack overflow.",
    module: "walk.mjs",
    broken: `export function walkTree(node, visit) {
  visit(node);
  for (const child of node.children ?? []) {
    walkTree(child, visit);
  }
}
`,
    fixed: `export function walkTree(node, visit) {
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    visit(cur);
    const kids = cur.children ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}
`,
    testBody: `
  import { walkTree } from "./walk.mjs";
  const deep = { id: 0, children: [] };
  let cur = deep;
  for (let i = 1; i < 5000; i++) {
    cur.children = [{ id: i, children: [] }];
    cur = cur.children[0];
  }
  const seen = [];
  walkTree(deep, (n) => seen.push(n.id));
  assert.equal(seen.length, 5000);
`,
  }),

  singleModuleTask({
    id: "fix-null-deref-chain",
    title: "Safe optional property access helper",
    source: tb("fix-code-vulnerability"),
    category: "bugfix",
    prompt: "getPath(obj, path) in path-get.mjs returns undefined instead of throwing on missing keys.",
    module: "path-get.mjs",
    broken: `export function getPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    cur = cur[key];
  }
  return cur;
}
`,
    fixed: `export function getPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}
`,
    testBody: `
  import { getPath } from "./path-get.mjs";
  assert.equal(getPath({ a: { b: 1 } }, ["a", "b"]), 1);
  assert.equal(getPath({ a: {} }, ["a", "b", "c"]), undefined);
`,
  }),

  singleModuleTask({
    id: "fix-off-by-one-slice",
    title: "Fix exclusive end in paginate helper",
    source: tb("query-optimize"),
    category: "bugfix",
    prompt: "paginate(items, page, pageSize) in page.mjs uses 1-based pages and inclusive bounds correctly.",
    module: "page.mjs",
    broken: `export function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;
  return items.slice(start, end);
}
`,
    fixed: `export function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return items.slice(start, end);
}
`,
    testBody: `
  import { paginate } from "./page.mjs";
  const items = [1,2,3,4,5];
  assert.deepEqual(paginate(items, 1, 2), [1,2]);
  assert.deepEqual(paginate(items, 2, 2), [3,4]);
`,
  }),

  singleModuleTask({
    id: "fix-promise-all-settled",
    title: "Collect all results even when some reject",
    source: tb("cancel-async-tasks"),
    category: "bugfix",
    prompt: "allSettled(tasks) in settle.mjs returns {status,value|reason}[] like Promise.allSettled.",
    module: "settle.mjs",
    broken: `export async function allSettled(tasks) {
  return Promise.all(tasks);
}
`,
    fixed: `export async function allSettled(tasks) {
  return Promise.all(
    tasks.map((t) =>
      Promise.resolve(t).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason }),
      ),
    ),
  );
}
`,
    testBody: `
  import { allSettled } from "./settle.mjs";
  const res = await allSettled([Promise.resolve(1), Promise.reject(new Error("x"))]);
  assert.equal(res[0].status, "fulfilled");
  assert.equal(res[1].status, "rejected");
`,
  }),

  singleModuleTask({
    id: "fix-iterator-invalidation",
    title: "Safe removal while iterating listeners",
    source: tb("headless-terminal"),
    category: "bugfix",
    prompt: "SnapshotListeners in listeners.mjs must copy before emit so off() during emit is safe.",
    module: "listeners.mjs",
    broken: `export class SnapshotListeners {
  constructor() {
    this.fns = [];
  }
  on(fn) {
    this.fns.push(fn);
  }
  off(fn) {
    this.fns = this.fns.filter((f) => f !== fn);
  }
  emit(x) {
    for (const fn of this.fns) fn(x);
  }
}
`,
    fixed: `export class SnapshotListeners {
  constructor() {
    this.fns = [];
  }
  on(fn) {
    this.fns.push(fn);
  }
  off(fn) {
    this.fns = this.fns.filter((f) => f !== fn);
  }
  emit(x) {
    for (const fn of [...this.fns]) fn(x);
  }
}
`,
    testBody: `
  import { SnapshotListeners } from "./listeners.mjs";
  import { readFileSync } from "node:fs";
  import { fileURLToPath } from "node:url";
  import path from "node:path";
  const bus = new SnapshotListeners();
  const order = [];
  const c = () => order.push("c");
  bus.on(() => {
    bus.off(c);
    order.push("a");
  });
  bus.on(() => order.push("b"));
  bus.on(c);
  bus.emit(0);
  assert.deepEqual(order, ["a", "b", "c"]);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "listeners.mjs"), "utf8");
  assert.ok(src.includes("[...this.fns]"));
`,
  }),

  singleModuleTask({
    id: "fix-regex-catastrophic",
    title: "Replace nested quantifier email regex",
    source: tb("filter-js-from-html"),
    category: "bugfix",
    prompt: "isEmail(s) in email.mjs must use a safe pattern without catastrophic backtracking.",
    module: "email.mjs",
    broken: `export function isEmail(s) {
  return /^([a-z]+)+@[a-z]+\\.com$/.test(s);
}
`,
    fixed: `export function isEmail(s) {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$/i.test(s);
}
`,
    testBody: `
  import { isEmail } from "./email.mjs";
  import { readFileSync } from "node:fs";
  import { fileURLToPath } from "node:url";
  import path from "node:path";
  assert.equal(isEmail("ada@example.com"), true);
  assert.equal(isEmail("not-an-email"), false);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "email.mjs"), "utf8");
  assert.ok(!src.includes("([a-z]+)+"));
`,
  }),
];
