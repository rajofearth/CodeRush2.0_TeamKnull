const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Inventory {
  constructor(stock) {
    this.stock = stock;
  }

  /** Reserve n units; resolves to remaining stock, rejects if insufficient. */
  async reserve(n) {
    const current = this.stock; // read
    await delay(5); // simulate async persistence — concurrent calls interleave here
    if (current < n) {
      throw new Error(`insufficient stock: have ${current}, want ${n}`);
    }
    this.stock = current - n; // write-back of a possibly stale value (lost update)
    return this.stock;
  }
}
