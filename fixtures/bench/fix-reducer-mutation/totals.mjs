const seed = {};
export function totalByKey(items) {
  for (const { key, n } of items) {
    seed[key] = (seed[key] ?? 0) + n;
  }
  return seed;
}
