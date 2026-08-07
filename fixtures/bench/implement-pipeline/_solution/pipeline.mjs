export function pipeline(fns) {
  return async (input) => {
    let cur = input;
    for (const fn of fns) {
      cur = await fn(cur);
    }
    return cur;
  };
}
