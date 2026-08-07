import { routes } from "./router.mjs";

export function handle(path) {
  const route = routes[path];
  if (route) return route();
  return { status: 404, body: "not found" };
}
