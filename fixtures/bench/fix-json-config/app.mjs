import { readFile } from "node:fs/promises";

const raw = await readFile(new URL("./config.json", import.meta.url), "utf8");
const config = JSON.parse(raw);

if (typeof config.name !== "string" || !config.name) {
  throw new Error("config.name must be a non-empty string");
}
if (!Number.isInteger(config.port) || config.port <= 0) {
  throw new Error("config.port must be a positive integer");
}
if (!Number.isInteger(config.retries) || config.retries < 1) {
  throw new Error("config.retries must be an integer >= 1");
}
if (
  !Array.isArray(config.features) ||
  !config.features.every((f) => typeof f === "string")
) {
  throw new Error("config.features must be an array of strings");
}

console.log(
  `${config.name} on :${config.port}, retries=${config.retries}, features=${config.features.join("+")}`,
);
