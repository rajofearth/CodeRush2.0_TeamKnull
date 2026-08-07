export class AsyncCounter {
  constructor() {
    this.value = 0;
    this._chain = Promise.resolve();
  }
  increment() {
    this._chain = this._chain.then(async () => {
      this.value += 1;
      return this.value;
    });
    return this._chain;
  }
}
