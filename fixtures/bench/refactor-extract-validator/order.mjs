function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}
export function validateOrder(qty) {
  if (!isPositiveInt(qty)) throw new Error("bad qty");
  return qty;
}
