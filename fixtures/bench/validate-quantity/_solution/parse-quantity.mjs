/**
 * Parse an order quantity. Must return a positive integer, or throw for any
 * input that is not a positive integer (see task prompt / check.mjs).
 */
export function parseQuantity(input) {
  const isNumber = typeof input === "number";
  const isNumericString =
    typeof input === "string" && input.trim() !== "" && /^\d+$/.test(input.trim());
  if (!isNumber && !isNumericString) {
    throw new TypeError(`invalid quantity: ${String(input)}`);
  }
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`quantity must be a positive integer, got ${String(input)}`);
  }
  return value;
}
