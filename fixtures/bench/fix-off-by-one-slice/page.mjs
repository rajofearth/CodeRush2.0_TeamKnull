export function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;
  return items.slice(start, end);
}
