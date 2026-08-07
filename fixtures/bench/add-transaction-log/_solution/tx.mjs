export class TxLog {
  constructor(state) {
    this.state = state;
    this._snapshots = [];
  }
  apply(mutator) {
    this._snapshots.push(structuredClone(this.state));
    mutator(this.state);
  }
  rollback() {
    const prev = this._snapshots.pop();
    if (prev) this.state = prev;
  }
}
