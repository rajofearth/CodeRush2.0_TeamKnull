export function stableSort(items, keyFn) {
  return [...items].sort((a, b) => keyFn(b) - keyFn(a));
}
