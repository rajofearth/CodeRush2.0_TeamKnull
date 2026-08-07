export function nearEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}
