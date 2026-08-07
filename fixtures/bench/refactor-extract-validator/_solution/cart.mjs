import { isPositiveInt } from "./validators.mjs";
export function validateCart(qty) {
  if (!isPositiveInt(qty)) throw new Error("bad qty");
  return qty;
}
