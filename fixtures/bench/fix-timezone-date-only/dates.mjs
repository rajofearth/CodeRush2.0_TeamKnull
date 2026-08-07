export function parseDateOnly(s) {
  return new Date(s + "T00:00:00");
}
