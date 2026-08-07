export async function allSettled(tasks) {
  return Promise.all(
    tasks.map((t) =>
      Promise.resolve(t).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason }),
      ),
    ),
  );
}
