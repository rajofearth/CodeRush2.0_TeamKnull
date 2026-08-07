export class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buf = [];
    this.i = 0;
  }
  push(item) {
    if (this.buf.length < this.capacity) {
      this.buf.push(item);
      return;
    }
    this.buf[this.i] = item;
    this.i = (this.i + 1) % this.capacity;
  }
  toArray() {
    if (this.buf.length < this.capacity) return [...this.buf];
    return [...this.buf.slice(this.i), ...this.buf.slice(0, this.i)];
  }
}
