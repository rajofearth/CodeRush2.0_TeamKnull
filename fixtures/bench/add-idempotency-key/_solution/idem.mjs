export class IdempotencyStore {
  constructor() {
    this.cache = new Map();
  }
  async run(key, handler) {
    if (this.cache.has(key)) return this.cache.get(key);
    const p = Promise.resolve().then(handler);
    this.cache.set(key, p);
    return p;
  }
}
