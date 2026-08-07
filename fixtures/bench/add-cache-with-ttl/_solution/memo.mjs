export function ttlMemo(fn, ttlMs) {
  const cache = new Map();
  return (key) => {
    const hit = cache.get(key);
    if (hit && Date.now() < hit.expires) return hit.value;
    const value = fn(key);
    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  };
}
