export class BatchBuffer {
  constructor(batchSize, onFlush) {
    this.batchSize = batchSize;
    this.onFlush = onFlush;
    this.buf = [];
  }
  push(item) {
    this.buf.push(item);
  }
}
