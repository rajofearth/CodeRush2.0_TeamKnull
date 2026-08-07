export async function safeRun(fn) {
  return { ok: true, value: await fn() };
}
