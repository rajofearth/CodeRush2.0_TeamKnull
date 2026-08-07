import { isPositiveInt } from "./validators.mjs";
export function validateOrder(qty) {
  if (!isPositiveInt(qty)) throw new Error("bad qty");
  return qty;
}
