/** Plain-text boxed reports for the ops console. */

function boxedReport(title, rows) {
  const width = 40;
  const border = "+" + "-".repeat(width) + "+";
  const pad = (text) => "| " + text.padEnd(width - 2) + " |";
  const lines = [border, pad(title), border];
  for (const row of rows) lines.push(pad(row));
  lines.push(border);
  return lines.join("\n");
}

export function formatUserReport(user) {
  return boxedReport("USER REPORT", [
    `name: ${user.name}`,
    `email: ${user.email}`,
  ]);
}

export function formatOrderReport(order) {
  return boxedReport("ORDER REPORT", [
    `id: ${order.id}`,
    `total: ${order.total}`,
  ]);
}
