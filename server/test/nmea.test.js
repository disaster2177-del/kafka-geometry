import { test } from 'node:test';
import assert from 'node:assert/strict';
import nmea0183 from '../src/kafka/adapters/nmea0183.js';
import { normaliseMessage } from '../src/services/normalizer.js';
import { aisName, aisPosition, hdt, rmc, tll, ttm } from '../scripts/lib/nmea.js';

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('decodes a real-world AIS type 1 sentence', () => {
  // Widely used reference sentence (gpsd test suite)
  const [m] = nmea0183('!AIVDM,1,1,,B,15M67FC000G?ufbE`FepT@3n00Sa,0*5C');
  assert.equal(m.id, 'AIS-366053209');
  assert.equal(m.kind, 'TRACK');
  near(m.geometry.position.lat, 37.8025, 1e-3);
  near(m.geometry.position.lon, -122.3419, 1e-3);
  normaliseMessage(m); // valid canonical message
});

test('own ship from RMC + HDT', () => {
  nmea0183(hdt(123.4));
  const [m] = nmea0183(rmc({ lat: 36.5, lon: -15.25, sog: 12.3, cog: 120 }));
  assert.equal(m.kind, 'OWNSHIP');
  near(m.geometry.position.lat, 36.5);
  near(m.geometry.position.lon, -15.25);
  assert.equal(m.properties.heading, 123.4);
  assert.equal(m.properties.speed, 12.3);
});

test('ARPA TTM / TLL targets and lost targets', () => {
  const [t] = nmea0183(ttm({ number: 7, range: 5.5, bearing: 45, speed: 10, course: 270, cpa: 1.2, tcpa: 8 }));
  assert.equal(t.id, 'RA-07');
  assert.deepEqual(t.geometry.position, { range: 5.5, bearing: 45 });
  assert.equal(t.properties.cpaNm, 1.2);
  const [l] = nmea0183(tll({ number: 8, lat: -10.5, lon: 100.25, name: 'TGT8' }));
  near(l.geometry.position.lat, -10.5);
  assert.equal(l.label, 'TGT8');
  const [d] = nmea0183(ttm({ number: 7, range: 5.5, bearing: 45, speed: 10, course: 270, status: 'L' }));
  assert.equal(d.action, 'DELETE');
});

test('AIS encoder round-trip with vessel name (msg 24)', () => {
  nmea0183(aisName({ mmsi: 247123456, name: 'MSC AURORA' }));
  const [m] = nmea0183(aisPosition({ mmsi: 247123456, lat: 36.61, lon: 15.12, sog: 14.2, cog: 88.5, heading: 90 }));
  assert.equal(m.label, 'MSC AURORA');
  near(m.geometry.position.lat, 36.61, 1e-5);
  near(m.geometry.position.lon, 15.12, 1e-5);
  assert.equal(m.properties.speed, 14.2);
  assert.equal(m.properties.course, 88.5);
});

test('bad checksum is rejected, multi-line payloads are split', () => {
  assert.throws(() => nmea0183('$HEHDT,100.0,T*00'), /checksum/);
  assert.equal(nmea0183(`${hdt(10)}\r\n${hdt(11)}\n`).length, 2);
});
