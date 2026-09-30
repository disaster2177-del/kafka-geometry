/** Minimal browser stand-in for Node's `node:events`, enough for the server modules used by the demo. */
export class EventEmitter {
  #listeners = new Map();

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(fn);
    return this;
  }

  off(event, fn) {
    this.#listeners.get(event)?.delete(fn);
    return this;
  }

  emit(event, ...args) {
    const fns = this.#listeners.get(event);
    if (!fns?.size) return false;
    [...fns].forEach((fn) => fn(...args));
    return true;
  }
}

export default EventEmitter;
