export function topoSort(graph) {
  const visited = new Set();
  const temp = new Set();
  const out = [];
  const visit = (n) => {
    if (visited.has(n)) return;
    if (temp.has(n)) throw new Error("cycle");
    temp.add(n);
    for (const dep of graph[n] ?? []) visit(dep);
    temp.delete(n);
    visited.add(n);
    out.push(n);
  };
  for (const n of Object.keys(graph)) visit(n);
  return out;
}
