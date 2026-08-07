export class Counter {
  constructor() {
    this.count = 0;
  }
  makeDelayedIncrement(ms) {
    return () => {
      setTimeout(() => {
        this.count += 1;
      }, ms);
    };
  }
}
