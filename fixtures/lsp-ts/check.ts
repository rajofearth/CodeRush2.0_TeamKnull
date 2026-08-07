import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(root, "greeter.ts"), "utf8");

// Pass when add() returns a number (type-correct) — offline demo flips the bug.
const fixed = /export function add\(a: number, b: number\): number/.test(src);
if (!fixed) {
  console.error("greeter.ts still has the intentional type bug");
  process.exit(1);
}
console.log("lsp-ts fixture ok");
