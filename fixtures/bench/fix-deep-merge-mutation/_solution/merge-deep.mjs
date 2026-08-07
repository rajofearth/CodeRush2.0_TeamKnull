export function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    const av = a[k];
    const bv = b[k];
    out[k] =
      av && bv && typeof av === "object" && typeof bv === "object" && !Array.isArray(av)
        ? deepMerge(av, bv)
        : bv;
  }
  return out;
}
