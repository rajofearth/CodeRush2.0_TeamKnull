export function logSequence(fn) {
  fn("warn", "setup");
  fn("info", "ready");
}
