/**
 * The demo naval scenario, independent of any transport. Used by the Kafka
 * simulator (scripts/simulator.js) and by the browser demo build of the client.
 *
 * createScenario().step() advances the scenario by 1/rate seconds and returns
 * the messages to publish per topic:
 *   [{ topic, messages: (object | string)[] }]   strings are raw NMEA sentences
 */
import { aisName, aisPosition, hdt, rmc, ttm } from './nmea.js';

export const DEFAULT_TOPICS = {
  nmea: 'radar.nmea',
  ais: 'ais.nmea',
  zones: 'c2.zones',
  tracks: 'radar.tracks',
  legacy: 'radar.legacy-plots',
  geometry: 'radar.geometry',
};

/** Adapter that the server binds to each default topic. */
export const TOPIC_ADAPTERS = {
  'radar.nmea': 'nmea0183',
  'ais.nmea': 'nmea0183',
  'c2.zones': 'canonical',
  'radar.tracks': 'canonical',
  'radar.legacy-plots': 'legacyPlot',
  'radar.geometry': 'canonical',
};

export function createScenario({ rate = 1, topics = {} } = {}) {
  const TOPICS = { ...DEFAULT_TOPICS, ...topics };
  const RATE = rate;
  const dt = 1 / RATE; // seconds per tick
  let tick = 0;

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

  // Merchant traffic reported by AIS (cooperative, NEUTRAL)
  const aisVessels = [
    { mmsi: 247123456, name: 'MSC AURORA', brg: 20, rng: 16, cog: 250, sog: 14.5 },
    { mmsi: 538004512, name: 'NORDIC PRIDE', brg: 95, rng: 12, cog: 330, sog: 11.2 },
    { mmsi: 636019825, name: 'OCEAN SPIRIT', brg: 140, rng: 20, cog: 10, sog: 17.8 },
    { mmsi: 229876000, name: 'MARIA K', brg: 230, rng: 8, cog: 60, sog: 6.1 },
    { mmsi: 244670316, name: 'ELBE TRADER', brg: 300, rng: 22, cog: 120, sog: 12.4 },
    { mmsi: 311000927, name: 'AL SALAM', brg: 345, rng: 5, cog: 180, sog: 3.2 },
  ].map((v) => ({ ...v, position: move(ownship.position, v.brg, v.rng) }));

  // Targets auto-acquired by the navigation radar's ARPA (reported as $RATTM)
  const arpaTargets = [
    { number: 1, brg: 70, rng: 6.5, course: 200, speed: 9 },
    { number: 2, brg: 165, rng: 3.8, course: 300, speed: 4 },
    { number: 3, brg: 275, rng: 10.5, course: 80, speed: 13 },
  ].map((t) => ({ ...t, position: move(ownship.position, t.brg, t.rng) }));

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
  /** Own ship nav data and ARPA targets as NMEA 0183 sentences (one Kafka message per sentence). */
  function nmeaSentences() {
    const lines = [
      hdt(ownship.heading),
      rmc({ lat: ownship.position.lat, lon: ownship.position.lon, sog: ownship.speed, cog: ownship.heading }),
    ];
    for (const t of arpaTargets) {
      const rb = rangeBearing(ownship.position, t.position);
      lines.push(ttm({ number: t.number, range: rb.range, bearing: rb.bearing, speed: t.speed, course: t.course }));
    }
    return lines;
  }

  /** AIS position reports (and periodically the vessel names) as !AIVDM sentences. */
  function aisSentences(includeNames) {
    const lines = [];
    for (const v of aisVessels) {
      if (includeNames) lines.push(aisName({ mmsi: v.mmsi, name: v.name }));
      lines.push(aisPosition({ mmsi: v.mmsi, lat: v.position.lat, lon: v.position.lon, sog: v.sog, cog: v.cog, heading: Math.round(v.cog) }));
    }
    return lines;
  }

  /** Areas and routes from the C2 system as a GeoJSON FeatureCollection. */
  function zonesGeoJson() {
    const ring = [...exclusionZone, exclusionZone[0]].map((p) => [round(p.lon), round(p.lat)]);
    const anchorage = move(route[0], 200, 18);
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'EXZ-ALPHA',
          geometry: { type: 'Polygon', coordinates: [ring] },
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
          geometry: { type: 'LineString', coordinates: route.map((p) => [round(p.lon), round(p.lat)]) },
          properties: { label: 'PLANNED ROUTE', identity: 'FRIEND', source: 'NAV', ttlSec: 0, style: { color: '#8bc34a', dashed: true } },
        },
        {
          type: 'Feature',
          id: 'ANCH-1',
          geometry: { type: 'Point', coordinates: [round(anchorage.lon), round(anchorage.lat)] },
          properties: { label: 'ANCHORAGE', identity: 'NEUTRAL', source: 'C2', ttlSec: 0, depthM: 32 },
        },
      ],
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

  function step() {
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

    for (const v of aisVessels) v.position = move(v.position, v.cog, v.sog * hours * 10);
    for (const t of arpaTargets) t.position = move(t.position, t.course, t.speed * hours * 10);

    for (const lt of legacyTracks) {
      lt.brg = norm360(lt.brg + rand(-0.4, 0.4));
      lt.rng = Math.max(1, lt.rng + rand(-0.05, 0.05));
    }

    const out = [
      send(TOPICS.nmea, nmeaSentences()),
      send(TOPICS.ais, aisSentences(tick === 1 || tick % Math.round(30 * RATE) === 0)),
      send(TOPICS.tracks, [...tracks.map(trackMsg), ...deletes]),
      send(
        TOPICS.legacy,
        legacyTracks.map((lt) => ({ ...lt, rng: round(lt.rng, 2), brg: round(lt.brg, 1), q: 6, ts: Date.now() / 1000 })),
      ),
    ];
    if (tick === 1 || tick % Math.max(1, Math.round(3 * RATE)) === 0) {
      out.push(send(TOPICS.geometry, staticGeometry()));
      out.push(send(TOPICS.zones, [zonesGeoJson()]));
    }
    return out;
  }

  const send = (topic, messages) => ({ topic, messages });

  return {
    step,
    topics: TOPICS,
    get tick() {
      return tick;
    },
    get trackCount() {
      return tracks.length + legacyTracks.length;
    },
  };
}
