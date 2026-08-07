import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatUserReport, formatOrderReport } from "./report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const expectedUser = [
  "+----------------------------------------+",
  "| USER REPORT                            |",
  "+----------------------------------------+",
  "| name: Ada                              |",
  "| email: ada@example.com                 |",
  "+----------------------------------------+",
].join("\n");

const expectedOrder = [
  "+----------------------------------------+",
  "| ORDER REPORT                           |",
  "+----------------------------------------+",
  "| id: 1042                               |",
  "| total: 99.5                            |",
  "+----------------------------------------+",
].join("\n");

try {
  assert.equal(
    formatUserReport({ name: "Ada", email: "ada@example.com" }),
    expectedUser,
    "formatUserReport output changed",
  );
  assert.equal(
    formatOrderReport({ id: 1042, total: 99.5 }),
    expectedOrder,
    "formatOrderReport output changed",
  );

  const source = readFileSync(path.join(here, "report.mjs"), "utf8");
  const marker = '"+" + "-".repeat(width) + "+"';
  const occurrences = source.split(marker).length - 1;
  assert.ok(
    occurrences <= 1,
    `duplicated border expression still appears ${occurrences} times (must be <= 1)`,
  );
  console.log("PASS refactor-report");
} catch (err) {
  console.error("FAIL refactor-report:", err.message);
  process.exit(1);
}
