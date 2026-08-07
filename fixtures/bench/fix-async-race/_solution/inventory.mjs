const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Inventory {
  #queue = Promise.resolve();

  constructor(stock) {
    this.stock = stock;
  }

  /** Reserve n units; resolves to remaining stock, rejects if insufficient. */
  async reserve(n) {
    const result = this.#queue.then(async () => {
      const current = this.stock;
      await delay(5); // simulate async persistence
      if (current < n) {
        throw new Error(`insufficient stock: have ${current}, want ${n}`);
      }
      this.stock = current - n;
      return this.stock;
    });
    // Keep the queue alive even when a reserve rejects.
    this.#queue = result.catch(() => {});
    return result;
  }
}
