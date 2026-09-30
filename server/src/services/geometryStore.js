import { EventEmitter } from 'node:events';

/**
 * In-memory "live tactical picture".
 *
 * Kafka can deliver thousands of updates per second; the browser does not need
 * all of them. The store keeps the latest state of every object and collects
 * changes which are flushed to Socket.IO clients (and MongoDB) in batches.
 *
 * Events:
 *   "flush" ({ upserts: object[], deletes: string[] })
 */
export class GeometryStore extends EventEmitter {
  constructor({ defaultTtlSec = 120, trackHistoryLength = 30 } = {}) {
    super();
    this.defaultTtlSec = defaultTtlSec;
    this.trackHistoryLength = trackHistoryLength;
    this.objects = new Map();
    this.pendingUpserts = new Map();
    this.pendingDeletes = new Set();
  }

  /** Load previously persisted objects (e.g. from MongoDB at startup). */
  hydrate(objects, now = Date.now()) {
    for (const obj of objects) {
      if (!this.#isExpired(obj, now)) this.objects.set(obj.id, obj);
    }
  }

  /**
   * Apply a canonical message.
   * @returns {'upserted'|'deleted'|'ignored'}
   */
  apply(msg) {
    const existing = this.objects.get(msg.id);

    if (msg.action === 'DELETE') {
      if (!existing) return 'ignored';
      this.#remove(msg.id);
      return 'deleted';
    }

    // Drop out-of-order updates (Kafka only guarantees order per partition).
    if (existing && msg.timestamp < existing.timestamp) return 'ignored';

    const obj = { ...msg };
    delete obj.action;

    if (obj.kind === 'TRACK') {
      const trail = existing?.kind === 'TRACK' ? [...(existing.trail ?? [])] : [];
      if (existing?.kind === 'TRACK' && !samePosition(existing.geometry.position, obj.geometry.position)) {
        trail.push({ position: existing.geometry.position, timestamp: existing.timestamp });
        if (trail.length > this.trackHistoryLength) trail.splice(0, trail.length - this.trackHistoryLength);
      }
      obj.trail = trail;
    }

    this.objects.set(obj.id, obj);
    this.pendingDeletes.delete(obj.id);
    this.pendingUpserts.set(obj.id, obj);
    return 'upserted';
  }

  /** Remove objects that have not been updated within their TTL. */
  sweep(now = Date.now()) {
    const expired = [];
    for (const obj of this.objects.values()) {
      if (this.#isExpired(obj, now)) expired.push(obj.id);
    }
    expired.forEach((id) => this.#remove(id));
    return expired;
  }

  remove(id) {
    if (!this.objects.has(id)) return false;
    this.#remove(id);
    return true;
  }

  clear() {
    for (const id of [...this.objects.keys()]) this.#remove(id);
  }

  /** Emit accumulated changes as one batch. */
  flush() {
    if (this.pendingUpserts.size === 0 && this.pendingDeletes.size === 0) return null;
    const batch = {
      upserts: [...this.pendingUpserts.values()],
      deletes: [...this.pendingDeletes],
    };
    this.pendingUpserts.clear();
    this.pendingDeletes.clear();
    this.emit('flush', batch);
    return batch;
  }

  get(id) {
    return this.objects.get(id);
  }

  list({ kind, identity, source } = {}) {
    let items = [...this.objects.values()];
    if (kind) items = items.filter((o) => o.kind === kind);
    if (identity) items = items.filter((o) => o.identity === identity);
    if (source) items = items.filter((o) => o.source === source);
    return items;
  }

  get size() {
    return this.objects.size;
  }

  #remove(id) {
    this.objects.delete(id);
    this.pendingUpserts.delete(id);
    this.pendingDeletes.add(id);
  }

  #isExpired(obj, now) {
    // Own ship never expires on its own - the UI flags it as stale instead.
    if (obj.kind === 'OWNSHIP' && obj.ttlSec == null) return false;
    const ttl = obj.ttlSec ?? this.defaultTtlSec;
    if (!ttl) return false;
    return now - obj.receivedAt > ttl * 1000;
  }
}

function samePosition(a, b) {
  if (!a || !b) return false;
  if (a.lat !== undefined) return a.lat === b.lat && a.lon === b.lon;
  return a.range === b.range && a.bearing === b.bearing;
}
