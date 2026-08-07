export function buildQuery(table, id) {
  return { sql: `SELECT * FROM ${table} WHERE id = ?`, params: [id] };
}
