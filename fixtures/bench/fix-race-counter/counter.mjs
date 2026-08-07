export class AsyncCounter {
  constructor() {
    this.value = 0;
  }
  async increment() {
    const cur = this.value;
    await Promise.resolve();
    this.value = cur + 1;
    return this.value;
  }
}
