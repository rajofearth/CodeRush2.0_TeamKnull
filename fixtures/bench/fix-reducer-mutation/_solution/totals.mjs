export function totalByKey(items) {
  const out = {};
  for (const { key, n } of items) {
    out[key] = (out[key] ?? 0) + n;
  }
  return out;
}
