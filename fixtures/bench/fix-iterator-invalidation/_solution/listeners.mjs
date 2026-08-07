export class SnapshotListeners {
  constructor() {
    this.fns = [];
  }
  on(fn) {
    this.fns.push(fn);
  }
  off(fn) {
    this.fns = this.fns.filter((f) => f !== fn);
  }
  emit(x) {
    for (const fn of [...this.fns]) fn(x);
  }
}
