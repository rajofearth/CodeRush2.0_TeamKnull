import path from "node:path";

export function safeJoin(root, userPath) {
  const resolved = path.resolve(root, userPath);
  const normalizedRoot = path.resolve(root);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error("path traversal");
  }
  return resolved;
}
