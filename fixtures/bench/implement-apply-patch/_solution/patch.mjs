export function applyPatch(original, patch) {
  const out = original.split("\n");
  const lines = patch.split("\n");
  let i = 0;
  for (const line of lines) {
    if (!line) continue;
    const tag = line[0];
    const text = line.slice(1);
    if (tag === " ") {
      if (out[i] !== text) throw new Error("patch mismatch");
      i++;
    } else if (tag === "-") {
      if (out[i] !== text) throw new Error("patch mismatch");
      out.splice(i, 1);
    } else if (tag === "+") {
      out.splice(i, 0, text);
      i++;
    }
  }
  return out.join("\n");
}
