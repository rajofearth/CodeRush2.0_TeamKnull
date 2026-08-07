export class ShutdownManager {
  constructor() {
    this.hooks = [];
  }
  onShutdown(fn) {
    this.hooks.push(fn);
  }
  async shutdown() {
    // bug: hooks never run
  }
}
