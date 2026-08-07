export function walkTree(node, visit) {
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    visit(cur);
    const kids = cur.children ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}
