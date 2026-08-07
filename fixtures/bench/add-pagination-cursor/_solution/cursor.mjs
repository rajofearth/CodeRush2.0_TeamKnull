export function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}
export function decodeCursor(token) {
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
}
