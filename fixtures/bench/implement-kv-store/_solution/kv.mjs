export class KVStore {
  constructor() {
    this._map = new Map();
  }
  set(key, value, ttlMs) {
    const expiresAt = ttlMs != null ? Date.now() + ttlMs : null;
    this._map.set(key, { value, expiresAt });
  }
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt != null && Date.now() >= entry.expiresAt) {
      this._map.delete(key);
      return undefined;
    }
    return entry.value;
  }
  delete(key) {
    return this._map.delete(key);
  }
}
