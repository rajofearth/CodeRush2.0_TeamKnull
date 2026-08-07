#!/usr/bin/env node
/**
 * Fixture check — exits 0 when hello.txt greets CLAI.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const text = readFileSync(path.join(dir, "hello.txt"), "utf8");
if (text.includes("Hello, CLAI!")) {
  console.log("ok: hello.txt greets CLAI");
  process.exit(0);
}
console.error("fail: expected 'Hello, CLAI!' in hello.txt");
console.error(text);
process.exit(1);
