export function recoverLatest(backups) {
  return backups.reduce((best, cur) => (cur.ts > best.ts ? cur : best));
}
