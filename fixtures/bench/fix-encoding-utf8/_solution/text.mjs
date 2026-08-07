export function sameText(a, b) {
  return a.normalize("NFC") === b.normalize("NFC");
}
