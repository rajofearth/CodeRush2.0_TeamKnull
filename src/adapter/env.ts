/**
 * Load `.env` from package root (and cwd) without printing secrets.
 * Safe no-op if dotenv is missing or files absent.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function loadEnvFiles(): Promise<void> {
  try {
    const dotenv = await import("dotenv");
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    dotenv.config({ path: path.join(root, ".env") });
    dotenv.config(); // cwd override
  } catch {
    // optional
  }
}
