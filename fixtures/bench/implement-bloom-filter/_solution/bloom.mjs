export class BloomFilter {
  constructor(size = 1024) {
    this.bits = new Uint8Array(size);
    this.size = size;
  }
  _hash(s, seed) {
    let h = seed;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % this.size;
  }
  add(value) {
    for (const seed of [1, 7, 13]) this.bits[this._hash(String(value), seed)] = 1;
  }
  maybeHas(value) {
    for (const seed of [1, 7, 13]) {
      if (!this.bits[this._hash(String(value), seed)]) return false;
    }
    return true;
  }
}
