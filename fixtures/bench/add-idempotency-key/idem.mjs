export class IdempotencyStore {
  async run(key, handler) {
    return handler();
  }
}
