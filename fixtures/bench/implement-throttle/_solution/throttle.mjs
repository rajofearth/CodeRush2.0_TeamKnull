export function throttle(fn, waitMs) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= waitMs) {
      last = now;
      fn(...args);
    }
  };
}
