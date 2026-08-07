export class App {
  constructor() {
    this.middleware = [];
  }
  use(fn) {
    this.middleware.push(fn);
  }
  async handle(req) {
    for (let i = this.middleware.length - 1; i >= 0; i--) {
      await this.middleware[i](req);
    }
  }
}
