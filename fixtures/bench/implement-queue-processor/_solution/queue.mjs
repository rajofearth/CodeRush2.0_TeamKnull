export class JobQueue {
  constructor() {
    this.jobs = [];
    this._chain = Promise.resolve();
  }
  enqueue(job) {
    this.jobs.push(job);
  }
  async drain() {
    const results = [];
    for (const job of this.jobs) {
      this._chain = this._chain.then(async () => {
        results.push(await job());
      });
    }
    await this._chain;
    return results;
  }
}
