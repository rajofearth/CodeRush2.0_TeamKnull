export class TaskRunner {
  constructor() {
    this._queue = Promise.resolve();
  }
  run(fn, { signal } = {}) {
    const job = () => {
      if (signal?.aborted) {
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      }
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", onAbort, { once: true });
        Promise.resolve(fn()).then(resolve, reject).finally(() => {
          signal?.removeEventListener("abort", onAbort);
        });
      });
    };
    this._queue = this._queue.then(job, job);
    return this._queue;
  }
}
