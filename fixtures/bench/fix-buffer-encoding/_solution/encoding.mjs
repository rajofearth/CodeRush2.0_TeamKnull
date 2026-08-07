export function equalUtf8(a, b) {
  return Buffer.from(a.normalize("NFC"), "utf8").equals(Buffer.from(b.normalize("NFC"), "utf8"));
}
