import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  execFileSync(process.execPath, ["slugify.test.mjs"], { cwd: here, stdio: "pipe" });
  console.log("PASS implement-slugify");
} catch (err) {
  console.error("FAIL implement-slugify:", err.stderr?.toString() || err.message);
  process.exit(1);
}
