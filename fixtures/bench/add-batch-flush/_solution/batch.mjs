export class BatchBuffer {
  constructor(batchSize, onFlush) {
    this.batchSize = batchSize;
    this.onFlush = onFlush;
    this.buf = [];
  }
  push(item) {
    this.buf.push(item);
    if (this.buf.length >= this.batchSize) {
      const batch = this.buf.splice(0, this.batchSize);
      this.onFlush(batch);
    }
  }
  flush() {
    if (this.buf.length) {
      this.onFlush(this.buf.splice(0));
    }
  }
}
