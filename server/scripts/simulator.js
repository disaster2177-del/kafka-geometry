#!/usr/bin/env node
/**
 * Naval scenario simulator - publishes geometry messages to Kafka so the UI can
 * be tested without the real sensors.
 *
 *   node scripts/simulator.js                  # publish to Kafka (KAFKA_BROKERS)
 *   node scripts/simulator.js --http           # POST to http://localhost:4000/api/ingest instead
 *   node scripts/simulator.js --rate 2         # updates per second (default 1)
 *
 * Topics used (all overridable with env vars):
 *   radar.ownship        OWNSHIP                  (canonical)
 *   radar.tracks         TRACK                    (canonical, absolute lat/lon)
 *   radar.legacy-plots   flat legacy radar format (legacyPlot adapter, range/bearing)
 *   radar.geometry       zones, routes, ESM bearings, coverage sectors, ellipses, markers
 */
import 'dotenv/config';
import { Kafka, Partitioners, logLevel } from 'kafkajs';

const args = process.argv.slice(2);
const argValue = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const USE_HTTP = args.includes('--http');
const HTTP_URL = argValue('--url', process.env.INGEST_URL || 'http://localhost:4000/api/ingest');
const RATE = Number(argValue('--rate', 1));

const TOPICS = {
  ownship: process.env.SIM_TOPIC_OWNSHIP || 'radar.ownship',
  tracks: process.env.SIM_TOPIC_TRACKS || 'radar.tracks',
  legacy: process.env.SIM_TOPIC_LEGACY || 'radar.legacy-plots',
  geometry: process.env.SIM_TOPIC_GEOMETRY || 'radar.geometry',
};

// ---------------------------------------------------------------- geo helpers
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const norm360 = (d) => ((d % 360) + 360) % 360;

/** Move a lat/lon by distance (NM) along bearing (deg). Flat-earth is fine at these ranges. */
function move({ lat, lon }, bearing, distNm) {
  const dLat = (distNm * Math.cos(toRad(bearing))) / 60;
  const dLon = (distNm * Math.sin(toRad(bearing))) / (60 * Math.cos(toRad(lat)));
  return { lat: lat + dLat, lon: lon + dLon };
}

function rangeBearing(from, to) {
  const dy = (to.lat - from.lat) * 60;
  const dx = (to.lon - from.lon) * 60 * Math.cos(toRad(from.lat));
  return { range: Math.hypot(dx, dy), bearing: norm360(toDeg(Math.atan2(dx, dy))) };
}

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const round = (v, n = 5) => Number(v.toFixed(n));

// ---------------------------------------------------------------- scenario
const ownship = {
  id: 'OWNSHIP',
  position: { lat: 36.5, lon: 15.2 },
  heading: 45,
  speed: 16,
};

const IDENTITIES = ['FRIEND', 'HOSTILE', 'NEUTRAL', 'UNKNOWN', 'SUSPECT', 'ASSUMED_FRIEND'];
const TYPES = {
  FRIEND: ['FFG', 'DDG', 'AOR'],
  ASSUMED_FRIEND: ['PATROL'],
  HOSTILE: ['FAC', 'CORVETTE', 'MPA'],
  SUSPECT: ['DHOW', 'FAST BOAT'],
  NEUTRAL: ['MERCHANT', 'TANKER', 'FISHING'],
  UNKNOWN: ['SURFACE CONTACT', 'AIR CONTACT'],
};

let trackSeq = 1000;
function newTrack() {
  const identity = pick(IDENTITIES);
  const platform = pick(TYPES[identity]);
  const air = platform === 'MPA' || platform === 'AIR CONTACT';
  return {
    id: `T${++trackSeq}`,
    identity,
    platform,
    domain: air ? 'AIR' : 'SURFACE',
    position: move(ownship.position, rand(0, 360), rand(4, 28)),
    course: rand(0, 360),
    speed: air ? rand(180, 320) / 10 : rand(6, 30), // air tracks slowed down for the demo
    altitude: air ? Math.round(rand(500, 8000)) : 0,
  };
}

const tracks = Array.from({ length: 10 }, newTrack);
const legacyTracks = [
  { trackNo: 501, rng: 9, brg: 300, crs: 120, spd: 12, ident: 'N' },
  { trackNo: 502, rng: 17, brg: 190, crs: 10, spd: 22, ident: 'S' },
];

const exclusionZone = [
  move(ownship.position, 20, 14),
  move(ownship.position, 40, 20),
  move(ownship.position, 75, 17),
  move(ownship.position, 60, 10),
];
const route = [
  ownship.position,
  move(ownship.position, 45, 12),
  move(ownship.position, 60, 24),
  move(ownship.position, 40, 38),
];
const datum = move(ownship.position, 150, 11);

// ---------------------------------------------------------------- messages
function ownshipMsg() {
  return {
    id: ownship.id,
    kind: 'OWNSHIP',
    source: 'NAV',
    label: 'OWN SHIP',
    identity: 'FRIEND',
    timestamp: Date.now(),
    geometry: { position: { lat: round(ownship.position.lat), lon: round(ownship.position.lon) } },
    properties: { heading: round(ownship.heading, 1), course: round(ownship.heading, 1), speed: ownship.speed },
  };
}

function trackMsg(t) {
  return {
    id: t.id,
    kind: 'TRACK',
    source: 'SPY-RADAR',
    identity: t.identity,
    label: t.id,
    timestamp: Date.now(),
    geometry: { position: { lat: round(t.position.lat), lon: round(t.position.lon) } },
    properties: {
      course: round(t.course, 1),
      speed: round(t.speed, 1),
      domain: t.domain,
      platform: t.platform,
      altitude: t.altitude,
      quality: Math.ceil(rand(4, 9)),
    },
  };
}

function staticGeometry() {
  const now = Date.now();
  const hostile = tracks.find((t) => t.identity === 'HOSTILE') ?? tracks[0];
  const unknown = tracks.find((t) => t.identity === 'UNKNOWN') ?? tracks[1];
  const esm = rangeBearing(ownship.position, hostile.position);

  return [
    {
      id: 'RADAR-COVERAGE',
      kind: 'SECTOR',
      source: 'SPY-RADAR',
      identity: 'FRIEND',
      label: 'RADAR COVERAGE',
      timestamp: now,
      geometry: {
        startBearing: norm360(ownship.heading + 150),
        endBearing: norm360(ownship.heading + 210),
        innerRadius: 0,
        outerRadius: 30,
      },
      style: { color: '#f5a623', fill: '#f5a623', fillOpacity: 0.08, dashed: true },
      properties: { note: 'Blind arc aft (superstructure masking)' },
    },
    {
      id: 'WEZ-SAM',
      kind: 'CIRCLE',
      source: 'CMS',
      identity: 'FRIEND',
      label: 'SAM WEZ',
      timestamp: now,
      geometry: { radius: 12 },
      style: { color: '#4fc3f7', dashed: true },
      properties: { weapon: 'SAM', maxRangeNm: 12 },
    },
    {
      id: `THREAT-${hostile.id}`,
      kind: 'CIRCLE',
      source: 'CMS',
      identity: 'HOSTILE',
      label: `${hostile.id} SSM`,
      timestamp: now,
      ttlSec: 15,
      geometry: { center: { lat: round(hostile.position.lat), lon: round(hostile.position.lon) }, radius: 6 },
      style: { fill: '#ff3b3b', fillOpacity: 0.07 },
      properties: { threat: 'Anti-ship missile envelope' },
    },
    {
      id: 'ESM-LOB-1',
      kind: 'BEARING',
      source: 'ESM',
      identity: 'HOSTILE',
      label: 'ESM 1',
      timestamp: now,
      ttlSec: 10,
      geometry: { bearing: round(esm.bearing + rand(-1.5, 1.5), 1) },
      properties: { emitter: 'I-band nav radar', frequencyMHz: 9410, prf: 1200 },
    },
    {
      id: 'AOU-1',
      kind: 'ELLIPSE',
      source: 'DATA FUSION',
      identity: 'UNKNOWN',
      label: 'AOU',
      timestamp: now,
      ttlSec: 15,
      geometry: {
        center: { lat: round(unknown.position.lat), lon: round(unknown.position.lon) },
        semiMajor: 2.5,
        semiMinor: 1.2,
        orientation: round(unknown.course, 1),
      },
      properties: { confidence: 0.9 },
    },
    {
      id: 'EXZ-ALPHA',
      kind: 'POLYGON',
      source: 'C2',
      identity: 'NEUTRAL',
      label: 'EXCLUSION ZONE ALPHA',
      timestamp: now,
      geometry: { points: exclusionZone.map((p) => ({ lat: round(p.lat), lon: round(p.lon) })) },
      style: { color: '#ff9800', fill: '#ff9800', fillOpacity: 0.1 },
      properties: { restriction: 'No entry', validUntil: new Date(now + 6 * 3600e3).toISOString() },
    },
    {
      id: 'ROUTE-1',
      kind: 'LINE',
      source: 'NAV',
      identity: 'FRIEND',
      label: 'PLANNED ROUTE',
      timestamp: now,
      geometry: { points: route.map((p) => ({ lat: round(p.lat), lon: round(p.lon) })) },
      style: { color: '#8bc34a', dashed: true },
      properties: { legs: route.length - 1 },
    },
    {
      id: 'DATUM-1',
      kind: 'POINT',
      source: 'ASW',
      identity: 'SUSPECT',
      label: 'DATUM',
      timestamp: now,
      geometry: { position: { lat: round(datum.lat), lon: round(datum.lon) } },
      properties: { type: 'Submarine datum', reportedBy: 'HELO' },
    },
  ];
}

// ---------------------------------------------------------------- transport
async function createTransport() {
  if (USE_HTTP) {
    console.log(`Simulator -> HTTP ${HTTP_URL}`);
    return {
      async send(topic, messages) {
        const adapter = topic === TOPICS.legacy ? '?adapter=legacyPlot' : '';
        const res = await fetch(HTTP_URL + adapter, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(messages),
        });
        if (!res.ok) console.error(`HTTP ${res.status}:`, await res.text());
      },
      async close() {},
    };
  }

  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({ clientId: 'naval-geometry-simulator', brokers, logLevel: logLevel.WARN });
  const admin = kafka.admin();
  await admin.connect();
  // Topics may already exist (or be auto-created by the consumer) - that's fine.
  await admin
    .createTopics({ topics: Object.values(TOPICS).map((topic) => ({ topic, numPartitions: 1 })) })
    .catch(() => {});
  await admin.disconnect();

  const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
  await producer.connect();
  console.log(`Simulator -> Kafka ${brokers.join(',')} topics ${Object.values(TOPICS).join(', ')}`);
  return {
    // Keyed by object id so updates for one object stay ordered within a partition.
    send: (topic, messages) =>
      producer.send({
        topic,
        messages: messages.map((m) => ({ key: String(m.id ?? m.trackNo), value: JSON.stringify(m) })),
      }),
    close: () => producer.disconnect(),
  };
}

// ---------------------------------------------------------------- main loop
async function main() {
  const transport = await createTransport();
  const dt = 1 / RATE; // seconds per tick
  let tick = 0;

  const step = async () => {
    tick += 1;
    const hours = dt / 3600;

    // own ship: gentle turns
    ownship.heading = norm360(ownship.heading + Math.sin(tick / 40) * 0.6);
    ownship.position = move(ownship.position, ownship.heading, ownship.speed * hours);

    const deletes = [];
    for (let i = 0; i < tracks.length; i += 1) {
      const t = tracks[i];
      t.course = norm360(t.course + rand(-2, 2));
      t.position = move(t.position, t.course, t.speed * hours * 10); // x10 so movement is visible
      if (rangeBearing(ownship.position, t.position).range > 40) {
        deletes.push({ id: t.id, action: 'DELETE', kind: 'TRACK', source: 'SPY-RADAR' });
        tracks[i] = newTrack();
      }
    }
    // occasionally a track is lost / dropped by the tracker
    if (Math.random() < 0.01 * dt) {
      const i = Math.floor(Math.random() * tracks.length);
      deletes.push({ id: tracks[i].id, action: 'DELETE', kind: 'TRACK', source: 'SPY-RADAR' });
      tracks[i] = newTrack();
    }

    for (const lt of legacyTracks) {
      lt.brg = norm360(lt.brg + rand(-0.4, 0.4));
      lt.rng = Math.max(1, lt.rng + rand(-0.05, 0.05));
    }

    const sends = [
      transport.send(TOPICS.ownship, [ownshipMsg()]),
      transport.send(TOPICS.tracks, [...tracks.map(trackMsg), ...deletes]),
      transport.send(
        TOPICS.legacy,
        legacyTracks.map((lt) => ({ ...lt, rng: round(lt.rng, 2), brg: round(lt.brg, 1), q: 6, ts: Date.now() / 1000 })),
      ),
    ];
    if (tick === 1 || tick % Math.max(1, Math.round(3 * RATE)) === 0) {
      sends.push(transport.send(TOPICS.geometry, staticGeometry()));
    }
    await Promise.all(sends);
    if (tick % Math.round(10 * RATE) === 0) console.log(`tick ${tick}: ${tracks.length + 2} tracks`);
  };

  const timer = setInterval(() => step().catch((err) => console.error('send failed:', err.message)), dt * 1000);
  await step();

  const stop = async () => {
    clearInterval(timer);
    await transport.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
