export class TokenBucket {
  constructor({ capacity, refillPerMs }) {
    this.capacity = capacity;
    this.refillPerMs = refillPerMs;
    this.tokens = capacity;
    this._last = Date.now();
  }
  _refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this._last) * this.refillPerMs);
    this._last = now;
  }
  consume(n) {
    this._refill();
    if (this.tokens < n) throw new Error("rate limited");
    this.tokens -= n;
  }
}
