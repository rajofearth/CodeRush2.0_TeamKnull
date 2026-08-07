export class AsyncCache {
  constructor() {
    this.map = new Map();
  }
  async get(key, loader) {
    if (this.map.has(key)) return this.map.get(key);
    const val = await loader();
    this.map.set(key, val);
    return val;
  }
}
