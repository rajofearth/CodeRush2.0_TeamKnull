export class TxLog {
  constructor(state) {
    this.state = state;
  }
  apply(mutator) {
    mutator(this.state);
  }
  rollback() {
    // no-op
  }
}
