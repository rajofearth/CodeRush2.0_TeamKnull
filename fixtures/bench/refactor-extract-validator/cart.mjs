function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}
export function validateCart(qty) {
  if (!isPositiveInt(qty)) throw new Error("bad qty");
  return qty;
}
