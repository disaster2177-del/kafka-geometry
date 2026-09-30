#!/usr/bin/env node
/**
 * Regenerates the files in /samples (valid checksums, consistent scenario).
 *   node scripts/generate-samples.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aisName, aisPosition, hdt, rmc, sentence, tll, ttm } from './lib/nmea.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples');
const T = Date.UTC(2026, 8, 30, 12, 0, 0);
const OWN = { lat: 36.5, lon: 15.2 };

const toRad = (d) => (d * Math.PI) / 180;
const move = ({ lat, lon }, brg, nm) => ({
  lat: +(lat + (nm * Math.cos(toRad(brg))) / 60).toFixed(5),
  lon: +(lon + (nm * Math.sin(toRad(brg))) / (60 * Math.cos(toRad(lat)))).toFixed(5),
});
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content.endsWith('\n') ? content : `${content}\n`);
  console.log('wrote samples/' + file);
};

// ---------------------------------------------------------------- NMEA radar / nav
const tl = move(OWN, 320, 9);
write(
  'nmea/radar-arpa.nmea',
  [
    hdt(45.0),
    rmc({ ...OWN, sog: 16.0, cog: 44.5, t: T }),
    sentence('$GPGGA', ['120000.00', '3630.0000', 'N', '01512.0000', 'E', '1', '09', '0.9', '12.0', 'M', '38.5', 'M', '', '']),
    sentence('$GPVTG', ['44.5', 'T', '41.8', 'M', '16.0', 'N', '29.6', 'K', 'A']),
    ttm({ number: 1, range: 6.5, bearing: 70, speed: 9, course: 200, cpa: 2.1, tcpa: 18.5, t: T }),
    ttm({ number: 2, range: 3.8, bearing: 165, speed: 4, course: 300, cpa: 0.4, tcpa: 11.2, name: 'FISHING', t: T }),
    ttm({ number: 3, range: 10.5, bearing: 275, speed: 13, course: 80, t: T }),
    ttm({ number: 4, range: 14.2, bearing: 15, speed: 22, course: 190, cpa: 0.9, tcpa: 25, t: T }),
    tll({ number: 5, ...tl, name: 'BUOY', t: T }),
    ttm({ number: 6, range: 12, bearing: 120, speed: 0, course: 0, status: 'L', t: T }),
  ].join('\n'),
);

// ---------------------------------------------------------------- AIS
const vessels = [
  { mmsi: 247123456, name: 'MSC AURORA', brg: 20, rng: 16, cog: 250, sog: 14.5 },
  { mmsi: 538004512, name: 'NORDIC PRIDE', brg: 95, rng: 12, cog: 330, sog: 11.2 },
  { mmsi: 636019825, name: 'OCEAN SPIRIT', brg: 140, rng: 20, cog: 10, sog: 17.8 },
  { mmsi: 229876000, name: 'MARIA K', brg: 230, rng: 8, cog: 60, sog: 6.1, status: 7 },
  { mmsi: 244670316, name: 'ELBE TRADER', brg: 300, rng: 22, cog: 120, sog: 12.4 },
  { mmsi: 311000927, name: 'AL SALAM', brg: 345, rng: 5, cog: 180, sog: 3.2 },
];
write(
  'nmea/ais.nmea',
  vessels
    .flatMap((v) => [
      aisName({ mmsi: v.mmsi, name: v.name }),
      aisPosition({ ...v, ...move(OWN, v.brg, v.rng), heading: Math.round(v.cog) }),
    ])
    .join('\n'),
);

// ---------------------------------------------------------------- GeoJSON
const zone = [move(OWN, 20, 14), move(OWN, 40, 20), move(OWN, 75, 17), move(OWN, 60, 10)];
const route = [OWN, move(OWN, 45, 12), move(OWN, 60, 24), move(OWN, 40, 38)];
const ll = (p) => [p.lon, p.lat];
write(
  'geojson/zones.geojson',
  JSON.stringify(
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'EXZ-ALPHA',
          geometry: { type: 'Polygon', coordinates: [[...zone, zone[0]].map(ll)] },
          properties: {
            label: 'EXCLUSION ZONE ALPHA',
            identity: 'NEUTRAL',
            source: 'C2',
            ttlSec: 0,
            style: { color: '#ff9800', fill: '#ff9800', fillOpacity: 0.1 },
            restriction: 'No entry',
          },
        },
        {
          type: 'Feature',
          id: 'ROUTE-1',
          geometry: { type: 'LineString', coordinates: route.map(ll) },
          properties: { label: 'PLANNED ROUTE', identity: 'FRIEND', source: 'NAV', ttlSec: 0, style: { color: '#8bc34a', dashed: true } },
        },
        {
          type: 'Feature',
          id: 'ANCH-1',
          geometry: { type: 'Point', coordinates: ll(move(OWN, 200, 18)) },
          properties: { label: 'ANCHORAGE', identity: 'NEUTRAL', source: 'C2', ttlSec: 0, depthM: 32 },
        },
      ],
    },
    null,
    2,
  ),
);

// ---------------------------------------------------------------- canonical JSON (one message per line)
const iso = new Date(T).toISOString();
const canonical = [
  { id: 'T2001', kind: 'TRACK', source: 'SPY-RADAR', identity: 'HOSTILE', timestamp: iso, geometry: { position: move(OWN, 200, 17) }, properties: { course: 20, speed: 28, platform: 'FAC', domain: 'SURFACE' } },
  { id: 'T2002', kind: 'TRACK', source: 'SPY-RADAR', identity: 'FRIEND', timestamp: iso, geometry: { position: move(OWN, 110, 9) }, properties: { course: 45, speed: 16, platform: 'FFG', domain: 'SURFACE' } },
  { id: 'T2003', kind: 'TRACK', source: 'SPY-RADAR', identity: 'SUSPECT', timestamp: iso, geometry: { position: move(OWN, 250, 20) }, properties: { course: 70, speed: 250, platform: 'MPA', domain: 'AIR', altitude: 3000 } },
  { id: 'T2004', kind: 'TRACK', source: 'SONAR', identity: 'UNKNOWN', timestamp: iso, geometry: { position: { range: 7, bearing: 150 } }, properties: { course: 90, speed: 6 } },
  { id: 'DATUM-1', kind: 'POINT', source: 'ASW', identity: 'SUSPECT', label: 'DATUM', timestamp: iso, geometry: { position: move(OWN, 150, 11) }, properties: { reportedBy: 'HELO' } },
  { id: 'WEZ-SAM', kind: 'CIRCLE', source: 'CMS', identity: 'FRIEND', label: 'SAM WEZ', timestamp: iso, ttlSec: 0, geometry: { radius: 12 }, style: { color: '#4fc3f7', dashed: true } },
  { id: 'THREAT-T2001', kind: 'CIRCLE', source: 'CMS', identity: 'HOSTILE', label: 'T2001 SSM', timestamp: iso, geometry: { center: move(OWN, 200, 17), radius: 6 }, style: { fill: '#ff3b3b', fillOpacity: 0.07 } },
  { id: 'AOU-1', kind: 'ELLIPSE', source: 'DATA FUSION', identity: 'UNKNOWN', label: 'AOU', timestamp: iso, geometry: { center: { range: 7, bearing: 150 }, semiMajor: 2.5, semiMinor: 1.2, orientation: 90 } },
  { id: 'RADAR-COVERAGE', kind: 'SECTOR', source: 'SPY-RADAR', identity: 'FRIEND', label: 'BLIND ARC', timestamp: iso, ttlSec: 0, geometry: { startBearing: 195, endBearing: 255, innerRadius: 0, outerRadius: 30 }, style: { color: '#f5a623', fill: '#f5a623', fillOpacity: 0.08, dashed: true } },
  { id: 'ESM-LOB-1', kind: 'BEARING', source: 'ESM', identity: 'HOSTILE', label: 'ESM 1', timestamp: iso, geometry: { bearing: 201.5 }, properties: { emitter: 'I-band nav radar', frequencyMHz: 9410 } },
  { id: 'BARRIER-1', kind: 'LINE', source: 'ASW', identity: 'FRIEND', label: 'SONOBUOY BARRIER', timestamp: iso, geometry: { points: [move(OWN, 130, 14), move(OWN, 160, 16), move(OWN, 185, 18)] }, style: { color: '#ce93d8', dashed: true } },
  { id: 'OPAREA', kind: 'POLYGON', source: 'C2', identity: 'FRIEND', label: 'OPAREA BRAVO', timestamp: iso, ttlSec: 0, geometry: { points: [{ range: 25, bearing: 300 }, { range: 28, bearing: 330 }, { range: 18, bearing: 345 }, { range: 15, bearing: 310 }] }, style: { color: '#4fc3f7', fill: '#4fc3f7', fillOpacity: 0.05 } },
];
write('canonical/geometry.jsonl', canonical.map((m) => JSON.stringify(m)).join('\n'));

// ---------------------------------------------------------------- legacy flat format
write(
  'legacy/plots.jsonl',
  [
    { trackNo: 501, rng: 9, brg: 300, crs: 120, spd: 12, ident: 'N', q: 6, ts: T / 1000 },
    { trackNo: 502, rng: 17, brg: 190, crs: 10, spd: 22, ident: 'S', q: 5, ts: T / 1000 },
  ]
    .map((m) => JSON.stringify(m))
    .join('\n'),
);
