export function diffLines(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  const sa = new Set(la);
  const sb = new Set(lb);
  return {
    added: lb.filter((l) => !sa.has(l)),
    removed: la.filter((l) => !sb.has(l)),
  };
}
