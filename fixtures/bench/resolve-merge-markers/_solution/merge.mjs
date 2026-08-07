export function resolveConflict(text) {
  const re = /<<<<<<<[^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>>[^\n]*\n?/g;
  return text.replace(re, (_, _ours, theirs) => theirs);
}
