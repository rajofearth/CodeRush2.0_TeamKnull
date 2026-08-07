export function reshard(lines, shardCount) {
  const shards = Array.from({ length: shardCount }, () => []);
  for (let i = 0; i < lines.length; i++) {
    shards[i % shardCount].push(lines[i]);
  }
  return shards;
}
