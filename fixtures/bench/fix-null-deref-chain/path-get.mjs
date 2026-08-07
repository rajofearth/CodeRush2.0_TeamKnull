export function getPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    cur = cur[key];
  }
  return cur;
}
