export function parseRecords(lines) {
  return lines.map((line) => ({
    id: line.slice(0, 20).trimEnd(),
    name: line.slice(20, 50).trimEnd(),
  }));
}
