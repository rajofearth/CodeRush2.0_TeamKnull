export class ShutdownManager {
  constructor() {
    this.hooks = [];
  }
  onShutdown(fn) {
    this.hooks.push(fn);
  }
  async shutdown() {
    for (const fn of this.hooks) {
      await fn();
    }
  }
}
