export function parseRecords(lines) {
  return lines.map((line) => ({ raw: line }));
}
