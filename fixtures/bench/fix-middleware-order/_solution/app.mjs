export class App {
  constructor() {
    this.middleware = [];
  }
  use(fn) {
    this.middleware.push(fn);
  }
  async handle(req) {
    for (const fn of this.middleware) {
      await fn(req);
    }
  }
}
