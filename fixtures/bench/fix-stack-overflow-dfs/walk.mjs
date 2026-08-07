export function walkTree(node, visit) {
  visit(node);
  for (const child of node.children ?? []) {
    walkTree(child, visit);
  }
}
