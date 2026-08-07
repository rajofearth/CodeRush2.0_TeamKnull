export async function allSettled(tasks) {
  return Promise.all(tasks);
}
