export function deepMerge(a, b) {
  for (const k of Object.keys(b)) {
    a[k] = b[k];
  }
  return a;
}
