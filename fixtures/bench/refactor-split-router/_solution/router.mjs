export const routes = {
  "/health": () => ({ status: 200, body: "ok" }),
  "/version": () => ({ status: 200, body: "1.0.0" }),
};
