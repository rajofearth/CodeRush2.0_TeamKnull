import { writeFileSync } from "node:fs";
import path from "node:path";
import { defaultTtl, hashFile, memoryTiers, openMemoryStore, type MemoryTier } from "./index.js";

const value = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const required = (input: string | undefined, message: string) => {
  if (!input) throw new Error(message);
  return input;
};

export async function runMemoryCli(args: string[]): Promise<void> {
  const store = await openMemoryStore({ directory: value(args, "--data-dir") });
  try {
    const command = args[0];
    if (command === "list") {
      const tier = value(args, "--tier") as MemoryTier | undefined;
      if (tier && !memoryTiers.includes(tier)) throw new Error(`Unknown tier: ${tier}`);
      const items = store.query({ tiers: tier ? [tier] : undefined, includeInvalidated: args.includes("--all") });
      if (args.includes("--json")) console.log(JSON.stringify(items, null, 2));
      else if (!items.length) console.log("No memory items.");
      else items.forEach((item) => console.log(`${item.id}\t${item.tier}\t${item.invalidatedAt ? "invalid" : "active"}\t${JSON.stringify(item.content)}`));
    } else if (command === "get") {
      const id = required(args[1], "memory get requires <id>");
      const item = store.get(id);
      if (!item) throw new Error(`Memory item not found: ${id}`);
      console.log(JSON.stringify(item, null, 2));
    } else if (command === "set") {
      const tier = required(args[1], "memory set requires <tier>") as MemoryTier;
      if (!memoryTiers.includes(tier)) throw new Error(`Unknown tier: ${tier}`);
      const raw = required(args[2], "memory set requires <content>");
      let content: unknown;
      try { content = JSON.parse(raw); } catch { content = raw; }
      const citePath = value(args, "--cite");
      const item = store.write({
        tier, content, citePath, citeHash: citePath ? hashFile(path.resolve(citePath)) : undefined,
        createdBy: value(args, "--by") ?? "user", source: value(args, "--source") ?? "user",
        confidence: Number(value(args, "--confidence") ?? 1), ttlClass: defaultTtl(tier),
      });
      const old = value(args, "--supersedes");
      if (old) store.supersede(old, item.id);
      console.log(JSON.stringify(item, null, 2));
    } else if (command === "delete") {
      const id = required(args[1], "memory delete requires <id>");
      const reason = value(args, "--invalidate");
      if (reason) store.invalidate(id, reason);
      else if (!store.delete(id)) throw new Error(`Memory item not found: ${id}`);
      console.log(`${reason ? "Invalidated" : "Deleted"} ${id}.`);
    } else if (command === "export") {
      const jsonl = store.query({ includeInvalidated: true }).map((item) => JSON.stringify(item)).join("\n");
      const output = value(args, "--output");
      if (output) { writeFileSync(output, jsonl ? `${jsonl}\n` : ""); console.log(`Exported memory JSONL to ${output}.`); }
      else console.log(jsonl);
    } else throw new Error("Usage: clai memory list|get|set|delete|export");
  } finally { store.close(); }
}
