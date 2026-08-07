export function parseStrictJson(text) {
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
}
