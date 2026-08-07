export function validateCreateUser(body) {
  if (!body?.name || !body?.email) throw new Error("missing fields");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new Error("invalid email");
  return { name: String(body.name), email: String(body.email) };
}
