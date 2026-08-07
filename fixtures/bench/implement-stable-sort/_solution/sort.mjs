export function stableSort(items, keyFn) {
  return items
    .map((item, index) => ({ item, index, key: keyFn(item) }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((x) => x.item);
}
