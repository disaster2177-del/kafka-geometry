import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseMessage, ValidationError } from '../src/services/normalizer.js';

const NOW = 1_700_000_000_000;
const n = (msg) => normaliseMessage(msg, { topic: 't', now: NOW });

test('track with absolute position', () => {
  const m = n({ id: 7, kind: 'track', identity: 'h', geometry: { position: { lat: 10, lon: 20 } } });
  assert.equal(m.id, '7');
  assert.equal(m.kind, 'TRACK');
  assert.equal(m.identity, 'HOSTILE');
  assert.deepEqual(m.geometry.position, { lat: 10, lon: 20 });
  assert.equal(m.timestamp, NOW);
  assert.equal(m.label, '7');
});

test('relative position, unit conversion and bearing wrap', () => {
  const m = n({ id: 'a', kind: 'POINT', geometry: { position: { rangeKm: 1.852, bearing: -10 } } });
  assert.deepEqual(m.geometry.position, { range: 1, bearing: 350 });
});

test('kind aliases and default own-ship centred geometry', () => {
  const m = n({ id: 'c', kind: 'range ring', geometry: { radius: 5 } });
  assert.equal(m.kind, 'CIRCLE');
  assert.deepEqual(m.geometry.center, { range: 0, bearing: 0 });
  const b = n({ id: 'b', kind: 'STROBE', geometry: { bearing: 370 } });
  assert.equal(b.kind, 'BEARING');
  assert.equal(b.geometry.bearing, 10);
  assert.equal(b.geometry.length, null);
});

test('GeoJSON feature with polygon drops the closing point', () => {
  const m = n({
    type: 'Feature',
    id: 'z1',
    geometry: { type: 'Polygon', coordinates: [[[1, 1], [2, 1], [2, 2], [1, 1]]] },
    properties: { label: 'Zone' },
  });
  assert.equal(m.kind, 'POLYGON');
  assert.equal(m.label, 'Zone');
  assert.equal(m.geometry.points.length, 3);
  assert.deepEqual(m.geometry.points[1], { lat: 1, lon: 2 });
});

test('timestamps in seconds and ISO format', () => {
  assert.equal(n({ id: 1, kind: 'POINT', timestamp: 1_700_000_000, geometry: { position: [0, 0] } }).timestamp, NOW);
  assert.equal(
    n({ id: 1, kind: 'POINT', timestamp: '2023-11-14T22:13:20Z', geometry: { position: [0, 0] } }).timestamp,
    NOW,
  );
});

test('delete messages need only an id', () => {
  const m = n({ id: 'x', action: 'delete' });
  assert.equal(m.action, 'DELETE');
});

test('validation errors', () => {
  const bad = [
    {},
    { id: 1 },
    { id: 1, kind: 'SPACESHIP', geometry: {} },
    { id: 1, kind: 'POINT', geometry: { position: { lat: 91, lon: 0 } } },
    { id: 1, kind: 'LINE', geometry: { points: [[0, 0]] } },
    { id: 1, kind: 'SECTOR', geometry: { startBearing: 0, endBearing: 90, innerRadius: 5, outerRadius: 2 } },
    { id: 1, kind: 'OWNSHIP', geometry: { position: { range: 1, bearing: 2 } } },
  ];
  for (const msg of bad) assert.throws(() => n(msg), ValidationError, JSON.stringify(msg));
});
