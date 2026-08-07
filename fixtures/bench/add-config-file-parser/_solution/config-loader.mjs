import fs from "node:fs/promises";

export async function loadConfig(path) {
  const text = await fs.readFile(path, "utf8");
  const cfg = JSON.parse(text);
  if (typeof cfg.port !== "number" || typeof cfg.host !== "string") {
    throw new Error("invalid config");
  }
  return cfg;
}
