/** Correct per SPEC.md — always exactly two decimal places. */
export function formatPrice(amount) {
  return `$${amount.toFixed(2)}`;
}
