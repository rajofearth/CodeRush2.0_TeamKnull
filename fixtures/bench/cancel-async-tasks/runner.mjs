export class TaskRunner {
  constructor() {
    this._queue = Promise.resolve();
  }
  run(fn, { signal } = {}) {
    const job = async () => fn();
    this._queue = this._queue.then(job, job);
    return this._queue;
  }
}
