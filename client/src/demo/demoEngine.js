/**
 * Browser-only demo backend. Runs the real server pipeline (adapters,
 * normaliser, live-picture store) on the same scenario the Kafka simulator
 * publishes, so the UI can be shown without Kafka, MongoDB or the API server.
 * Built only with `npm run build:demo` (VITE_DEMO=true).
 */
import { GeometryStore } from '../../../server/src/services/geometryStore.js';
import { IngestPipeline } from '../../../server/src/services/ingest.js';
import { getAdapter } from '../../../server/src/kafka/adapters/index.js';
import { createScenario, TOPIC_ADAPTERS } from '../../../server/scripts/lib/scenario.js';

const HISTORY_PER_OBJECT = 50;
const WARM_UP_TICKS = 25; // pre-run so tracks start with history trails

export function createDemoEngine() {
  const store = new GeometryStore({ defaultTtlSec: 120, trackHistoryLength: 30 });

  // Stands in for MongoDB: keeps the latest messages per object for the History view.
  const history = new Map();
  const persistence = {
    recordEvent(msg) {
      const list = history.get(msg.id) ?? [];
      list.unshift({ objectId: msg.id, action: msg.action, timestamp: msg.timestamp, geometry: msg.geometry });
      list.length = Math.min(list.length, HISTORY_PER_OBJECT);
      history.set(msg.id, list);
    },
  };
  const pipeline = new IngestPipeline({ store, persistence });
  const scenario = createScenario({ rate: 1 });
  const topics = Object.values(scenario.topics).map((topic) => ({ topic, adapter: TOPIC_ADAPTERS[topic] }));

  const listeners = { snapshot: new Set(), batch: new Set(), status: new Set() };
  const emit = (event, payload) => listeners[event].forEach((cb) => cb(payload));
  store.on('flush', (batch) => emit('batch', batch));

  const status = () => ({
    kafka: { state: 'demo', brokers: ['in-browser simulator'], topics, error: null },
    stats: pipeline.snapshotStats(),
    objects: store.size,
    serverTime: Date.now(),
  });

  // Each message goes through the adapter bound to its topic, exactly like the Kafka consumer.
  const tick = () => {
    for (const { topic, messages } of scenario.step()) {
      const adapter = getAdapter(TOPIC_ADAPTERS[topic]);
      for (const m of messages) pipeline.ingest(m, adapter, { topic });
    }
  };

  for (let i = 0; i < WARM_UP_TICKS; i += 1) tick();
  store.flush();

  let timers = [];
  return {
    on(event, cb) {
      listeners[event].add(cb);
      if (event === 'snapshot') cb(store.list());
      if (event === 'status') cb(status());
      return () => listeners[event].delete(cb);
    },
    start() {
      if (timers.length) return;
      timers = [
        setInterval(tick, 1000),
        setInterval(() => store.flush(), 200),
        setInterval(() => store.sweep(), 1000),
        setInterval(() => emit('status', status()), 1000),
      ];
    },
    stop() {
      timers.forEach(clearInterval);
      timers = [];
    },
    errors: () => pipeline.recentErrors,
    history: (id) => history.get(id) ?? [],
    remove: (id) => store.remove(id),
  };
}
