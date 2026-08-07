export class Observable {
  constructor() {
    this.subs = new Set();
  }
  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  emit(value) {
    for (const fn of this.subs) fn(value);
  }
}
