export class JobQueue {
  constructor() {
    this.jobs = [];
  }
  enqueue(job) {
    this.jobs.push(job);
  }
  async drain() {
    return Promise.all(this.jobs.map((j) => j()));
  }
}
