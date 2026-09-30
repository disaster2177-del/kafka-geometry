import { normaliseMessage, ValidationError } from './normalizer.js';
import logger from '../logger.js';

const MAX_RECENT_ERRORS = 50;

/**
 * Pipeline shared by the Kafka consumer and the HTTP ingest endpoint:
 *   raw payload -> adapter -> normaliser -> live store (+ history)
 */
export class IngestPipeline {
  constructor({ store, persistence }) {
    this.store = store;
    this.persistence = persistence;
    this.stats = {
      received: 0,
      accepted: 0,
      ignored: 0,
      rejected: 0,
      byTopic: {},
      lastMessageAt: null,
    };
    this.recentErrors = [];
    this.windowCount = 0;
    this.rate = 0; // messages / second over the last window
    this.rateTimer = setInterval(() => {
      this.rate = this.windowCount;
      this.windowCount = 0;
    }, 1000);
    this.rateTimer.unref?.(); // Node only; this module also runs in the browser demo
  }

  /**
   * @param {any} value   parsed JSON payload
   * @param {Function} adapter
   * @param {{ topic?: string, partition?: number, offset?: string, key?: string }} meta
   * @returns {{ accepted: number, rejected: number, errors: string[] }}
   */
  ingest(value, adapter, meta = {}) {
    const result = { accepted: 0, rejected: 0, errors: [] };
    let items;
    try {
      items = adapter(value, meta);
      if (!Array.isArray(items)) items = [items];
    } catch (err) {
      this.#reject(meta, `Adapter error: ${err.message}`, value, result);
      return result;
    }

    const now = Date.now();
    for (const raw of items) {
      this.stats.received += 1;
      this.windowCount += 1;
      const topic = meta.topic ?? 'http';
      this.stats.byTopic[topic] = (this.stats.byTopic[topic] ?? 0) + 1;
      this.stats.lastMessageAt = now;

      try {
        const msg = normaliseMessage(raw, { topic, now });
        const outcome = this.store.apply(msg);
        if (outcome === 'ignored') {
          this.stats.ignored += 1;
          continue;
        }
        this.stats.accepted += 1;
        result.accepted += 1;
        this.persistence?.recordEvent(msg);
      } catch (err) {
        if (!(err instanceof ValidationError)) logger.error('Unexpected ingest error:', err);
        this.#reject(meta, err.message, raw, result);
      }
    }
    return result;
  }

  #reject(meta, reason, payload, result) {
    this.stats.rejected += 1;
    result.rejected += 1;
    result.errors.push(reason);
    this.recentErrors.unshift({
      at: Date.now(),
      topic: meta.topic ?? 'http',
      offset: meta.offset,
      reason,
      payload: truncate(payload),
    });
    this.recentErrors.length = Math.min(this.recentErrors.length, MAX_RECENT_ERRORS);
    logger.debug(`Rejected message on ${meta.topic ?? 'http'}: ${reason}`);
  }

  snapshotStats() {
    return { ...this.stats, byTopic: { ...this.stats.byTopic }, ratePerSec: this.rate };
  }
}

function truncate(payload) {
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return '[unserialisable]';
  }
}
