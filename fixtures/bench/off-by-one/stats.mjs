/**
 * Tiny stats helpers. sumRange(a, b) must sum every integer from a to b,
 * including both endpoints.
 */

export function sumRange(a, b) {
  let total = 0;
  for (let i = a; i < b; i++) {
    total += i;
  }
  return total;
}

export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}
