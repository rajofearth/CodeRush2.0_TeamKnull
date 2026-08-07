export class UniqueStore {
  constructor() {
    this.map = new Map();
  }
  put(key, val) {
    this.map.set(key, val);
  }
}
