import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeometryStore } from '../src/services/geometryStore.js';
import { IngestPipeline } from '../src/services/ingest.js';
import canonical from '../src/kafka/adapters/canonical.js';
import legacyPlot from '../src/kafka/adapters/legacyPlot.js';

const track = (id, lat, ts, extra = {}) => ({
  id,
  kind: 'TRACK',
  timestamp: ts,
  geometry: { position: { lat, lon: 0 } },
  ...extra,
});

test('tracks build a trail, out-of-order updates are ignored', () => {
  const store = new GeometryStore({ trackHistoryLength: 2 });
  const p = new IngestPipeline({ store });
  p.ingest([track('T1', 1, 1000), track('T1', 2, 2000), track('T1', 3, 3000), track('T1', 4, 4000)], canonical);
  p.ingest(track('T1', 9, 1500), canonical);
  const t = store.get('T1');
  assert.equal(t.geometry.position.lat, 4);
  assert.deepEqual(t.trail.map((x) => x.position.lat), [2, 3]);
  assert.equal(p.stats.ignored, 1);
});

test('flush batches upserts and deletes', () => {
  const store = new GeometryStore();
  const p = new IngestPipeline({ store });
  p.ingest([track('A', 1, 1), track('B', 1, 1)], canonical);
  assert.equal(store.flush().upserts.length, 2);
  p.ingest({ id: 'A', action: 'DELETE' }, canonical);
  const batch = store.flush();
  assert.deepEqual(batch, { upserts: [], deletes: ['A'] });
  assert.equal(store.flush(), null);
});

test('TTL sweep removes stale objects but keeps own ship', () => {
  const store = new GeometryStore({ defaultTtlSec: 10 });
  const p = new IngestPipeline({ store });
  p.ingest([
    track('A', 1, 1),
    track('B', 1, 1, { ttlSec: 0 }),
    { id: 'OS', kind: 'OWNSHIP', geometry: { position: { lat: 0, lon: 0 } } },
  ], canonical);
  const removed = store.sweep(Date.now() + 60_000);
  assert.deepEqual(removed, ['A']);
  assert.equal(store.size, 2);
});

test('invalid messages are counted and logged, valid ones in the same batch still apply', () => {
  const store = new GeometryStore();
  const p = new IngestPipeline({ store });
  const r = p.ingest([track('A', 1, 1), { id: 'bad', kind: 'POINT' }], canonical);
  assert.equal(r.accepted, 1);
  assert.equal(r.rejected, 1);
  assert.equal(p.recentErrors.length, 1);
});

test('legacyPlot adapter maps flat radar plots', () => {
  const store = new GeometryStore();
  const p = new IngestPipeline({ store });
  p.ingest({ trackNo: 5, rng: 3, brg: 90, crs: 180, spd: 10, ident: 'N', ts: 1_700_000_000 }, legacyPlot, {
    topic: 'legacy',
  });
  const t = store.get('L5');
  assert.equal(t.identity, 'NEUTRAL');
  assert.deepEqual(t.geometry.position, { range: 3, bearing: 90 });
  assert.equal(t.properties.speed, 10);
  assert.equal(t.topic, 'legacy');
});
