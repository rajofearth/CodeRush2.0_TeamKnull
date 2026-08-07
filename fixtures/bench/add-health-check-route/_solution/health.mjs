export function healthHandler(deps) {
  if (!deps.ready) return { status: "error", code: 503 };
  return { status: "ok", code: 200 };
}
