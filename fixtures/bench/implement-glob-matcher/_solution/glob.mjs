export function globMatch(pattern, path) {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const re = esc.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
  return new RegExp("^" + re + "$").test(path);
}
