export class Counter {
  constructor() {
    this.count = 0;
  }
  makeDelayedIncrement(ms) {
    const snapshot = this.count;
    return () => {
      setTimeout(() => {
        this.count = snapshot + 1;
      }, ms);
    };
  }
}
