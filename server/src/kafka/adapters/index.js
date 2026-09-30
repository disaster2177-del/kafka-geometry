/**
 * Adapters translate the payload of a specific Kafka topic into one or more
 * "raw canonical" objects which are then validated by normaliseMessage().
 *
 * Every upstream system (radar tracker, ESM, C2 system, ...) tends to have its
 * own schema. Instead of changing the core, add an adapter here and bind it to
 * a topic with KAFKA_TOPICS, e.g.  KAFKA_TOPICS=esm.lob:esm,radar.tracks
 *
 * Signature: (value: any, meta: { topic, partition, offset, key, headers }) => object | object[]
 * `value` is parsed JSON, or the raw text for adapters listed in TEXT_ADAPTERS.
 */
import canonical from './canonical.js';
import legacyPlot from './legacyPlot.js';
import nmea0183 from './nmea0183.js';

const adapters = {
  canonical,
  legacyPlot,
  nmea0183,
};

// Adapters that take the raw message text instead of parsed JSON.
export const TEXT_ADAPTERS = new Set([nmea0183]);

export function getAdapter(name) {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(`Unknown Kafka adapter "${name}". Available: ${Object.keys(adapters).join(', ')}`);
  }
  return adapter;
}

export function listAdapters() {
  return Object.keys(adapters);
}
