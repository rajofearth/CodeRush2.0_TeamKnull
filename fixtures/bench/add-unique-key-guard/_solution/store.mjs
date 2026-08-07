export class UniqueStore {
  constructor() {
    this.map = new Map();
  }
  put(key, val) {
    if (this.map.has(key)) throw new Error("duplicate key");
    this.map.set(key, val);
  }
  set(key, val, force = false) {
    if (this.map.has(key) && !force) throw new Error("duplicate key");
    this.map.set(key, val);
  }
}
