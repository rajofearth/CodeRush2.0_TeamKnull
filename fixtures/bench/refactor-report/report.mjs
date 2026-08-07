/** Plain-text boxed reports for the ops console. */

export function formatUserReport(user) {
  const width = 40;
  const border = "+" + "-".repeat(width) + "+";
  const title = "| " + "USER REPORT".padEnd(width - 2) + " |";
  const lines = [border, title, border];
  lines.push("| " + `name: ${user.name}`.padEnd(width - 2) + " |");
  lines.push("| " + `email: ${user.email}`.padEnd(width - 2) + " |");
  lines.push(border);
  return lines.join("\n");
}

export function formatOrderReport(order) {
  const width = 40;
  const border = "+" + "-".repeat(width) + "+";
  const title = "| " + "ORDER REPORT".padEnd(width - 2) + " |";
  const lines = [border, title, border];
  lines.push("| " + `id: ${order.id}`.padEnd(width - 2) + " |");
  lines.push("| " + `total: ${order.total}`.padEnd(width - 2) + " |");
  lines.push(border);
  return lines.join("\n");
}
