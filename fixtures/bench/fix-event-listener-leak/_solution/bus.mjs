export class EventBus {
  constructor() {
    this._events = new Map();
  }
  on(event, fn) {
    if (!this._events.has(event)) this._events.set(event, new Set());
    this._events.get(event).add(fn);
  }
  off(event, fn) {
    this._events.get(event)?.delete(fn);
  }
  emit(event, payload) {
    for (const fn of this._events.get(event) ?? []) fn(payload);
  }
}
