export function parseStrictJson(text) {
  if (/,(\s*[}\]])/.test(text)) {
    throw new SyntaxError("trailing comma");
  }
  return JSON.parse(text);
}
