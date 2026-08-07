/**
 * Load `.env` from package root (and cwd) without printing secrets or tips.
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
    const quiet = { quiet: true } as { quiet?: boolean };
    dotenv.config({ path: path.join(root, ".env"), ...quiet });
    dotenv.config(quiet);
  } catch {
    // optional
  }
}
