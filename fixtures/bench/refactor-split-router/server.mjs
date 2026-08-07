export function handle(path) {
  if (path === "/health") return { status: 200, body: "ok" };
  if (path === "/version") return { status: 200, body: "1.0.0" };
  return { status: 404, body: "not found" };
}
