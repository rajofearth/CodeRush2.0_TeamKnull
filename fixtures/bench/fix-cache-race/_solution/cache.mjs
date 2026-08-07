export class AsyncCache {
  constructor() {
    this.map = new Map();
    this.pending = new Map();
  }
  async get(key, loader) {
    if (this.map.has(key)) return this.map.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    const p = Promise.resolve().then(loader).then((val) => {
      this.map.set(key, val);
      this.pending.delete(key);
      return val;
    });
    this.pending.set(key, p);
    return p;
  }
}
