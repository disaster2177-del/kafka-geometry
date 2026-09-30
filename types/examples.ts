/**
 * One example per geometry type. Also a compile-time test of geometry.d.ts:
 * `npm run typecheck` fails if the types drift from these (valid) messages.
 */
import type {
  BearingMessage,
  CanonicalPayload,
  CircleMessage,
  DeleteMessage,
  EllipseMessage,
  GeoJsonFeatureMessage,
  GeometryMessage,
  GeometryObject,
  LegacyPlotMessage,
  LineMessage,
  OwnshipMessage,
  PointMessage,
  PolygonMessage,
  SectorMessage,
  ServerToClientEvents,
  TrackMessage,
} from './geometry';

// ------------------------------------------------------------------ input messages

export const ownship: OwnshipMessage = {
  id: 'OWNSHIP',
  kind: 'OWNSHIP',
  source: 'NAV',
  timestamp: '2026-09-30T12:00:00Z',
  geometry: { position: { lat: 36.5, lon: 15.2 } },
  properties: { heading: 45, course: 44.5, speed: 16 },
};

export const track: TrackMessage = {
  id: 'T1001',
  kind: 'TRACK',
  source: 'SPY-RADAR',
  identity: 'HOSTILE',
  timestamp: 1790000000000,
  ttlSec: 30,
  geometry: { position: { lat: 36.62, lon: 15.31 } },
  properties: { course: 270, speed: 28, domain: 'SURFACE', platform: 'FAC' },
};

export const relativeTrack: TrackMessage = {
  id: 'SONAR-7',
  kind: 'contact' as 'CONTACT', // aliases are case-insensitive at runtime
  identity: 'U',
  geometry: { position: { rangeKm: 9.3, bearing: 150 } },
};

export const point: PointMessage = {
  id: 'DATUM-1',
  kind: 'POINT',
  identity: 'SUSPECT',
  label: 'DATUM',
  geometry: { position: [15.25, 36.41] }, // GeoJSON order [lon, lat]
  properties: { reportedBy: 'HELO' },
};

export const line: LineMessage = {
  id: 'ROUTE-1',
  kind: 'LINE',
  label: 'PLANNED ROUTE',
  geometry: {
    points: [
      { lat: 36.5, lon: 15.2 },
      { lat: 36.64, lon: 15.39 },
      { lat: 36.7, lon: 15.63 },
    ],
  },
  style: { color: '#8bc34a', dashed: true },
};

export const polygon: PolygonMessage = {
  id: 'EXZ-ALPHA',
  kind: 'ZONE',
  identity: 'NEUTRAL',
  ttlSec: 0,
  geometry: {
    points: [
      { range: 14, bearing: 20 },
      { range: 20, bearing: 40 },
      { range: 17, bearing: 75 },
      { range: 10, bearing: 60 },
    ],
  },
  style: { color: '#ff9800', fill: '#ff9800', fillOpacity: 0.1 },
};

export const circle: CircleMessage = {
  id: 'WEZ-SAM',
  kind: 'CIRCLE',
  label: 'SAM WEZ',
  geometry: { radius: 12 }, // centred on own ship
  style: { dashed: true },
};

export const ellipse: EllipseMessage = {
  id: 'AOU-1',
  kind: 'ELLIPSE',
  identity: 'UNKNOWN',
  geometry: { center: { lat: 36.4, lon: 15.3 }, semiMajor: 2.5, semiMinor: 1.2, orientation: 90 },
};

export const sector: SectorMessage = {
  id: 'BLIND-ARC',
  kind: 'SECTOR',
  geometry: { startBearing: 195, endBearing: 255, outerRadius: 30 },
  style: { fill: '#f5a623', fillOpacity: 0.08, dashed: true },
};

export const bearing: BearingMessage = {
  id: 'ESM-LOB-1',
  kind: 'BEARING',
  source: 'ESM',
  identity: 'HOSTILE',
  geometry: { bearing: 201.5 }, // from own ship to the edge of the scope
  properties: { emitter: 'I-band nav radar', frequencyMHz: 9410 },
};

export const drop: DeleteMessage = { id: 'T1001', action: 'DELETE' };

export const feature: GeoJsonFeatureMessage = {
  type: 'Feature',
  id: 'ANCH-1',
  geometry: { type: 'Point', coordinates: [15.1, 36.22] },
  properties: { label: 'ANCHORAGE', identity: 'NEUTRAL', depthM: 32 },
};

export const legacy: LegacyPlotMessage = { trackNo: 501, rng: 9, brg: 300, crs: 120, spd: 12, ident: 'N', ts: 1790000000 };

export const batch: CanonicalPayload = [ownship, track, point, line, polygon, circle, ellipse, sector, bearing, drop, feature];

// ------------------------------------------------------------------ invalid messages (must NOT compile)

// @ts-expect-error own ship must be an absolute position
export const badOwnship: OwnshipMessage = { id: 'X', kind: 'OWNSHIP', geometry: { position: { range: 1, bearing: 2 } } };
// @ts-expect-error a polygon needs at least 3 points
export const badPolygon: PolygonMessage = { id: 'X', kind: 'POLYGON', geometry: { points: [[0, 0], [1, 1]] } };
// @ts-expect-error a circle needs a radius
export const badCircle: CircleMessage = { id: 'X', kind: 'CIRCLE', geometry: {} };
// @ts-expect-error unknown kind
export const badKind: GeometryMessage = { id: 'X', kind: 'SPACESHIP', geometry: { position: [0, 0] } };

// ------------------------------------------------------------------ consuming canonical objects

/** `kind` narrows `geometry` and `properties` for each geometry type. */
export function describe(obj: GeometryObject): string {
  switch (obj.kind) {
    case 'OWNSHIP':
      return `own ship at ${obj.geometry.position.lat},${obj.geometry.position.lon} hdg ${obj.properties.heading ?? '-'}`;
    case 'TRACK':
      return `track ${obj.label} (${obj.trail.length} trail points) spd ${obj.properties.speed ?? '-'}`;
    case 'POINT':
      return `point ${obj.label}`;
    case 'LINE':
      return `line with ${obj.geometry.points.length} points`;
    case 'POLYGON':
      return `polygon with ${obj.geometry.points.length} vertices`;
    case 'CIRCLE':
      return `circle r=${obj.geometry.radius} NM`;
    case 'ELLIPSE':
      return `ellipse ${obj.geometry.semiMajor}x${obj.geometry.semiMinor} NM @ ${obj.geometry.orientation}°`;
    case 'SECTOR':
      return `sector ${obj.geometry.startBearing}-${obj.geometry.endBearing}° to ${obj.geometry.outerRadius} NM`;
    case 'BEARING':
      return `bearing ${obj.geometry.bearing}° ${obj.geometry.length === null ? 'to scope edge' : `${obj.geometry.length} NM`}`;
    default: {
      const unreachable: never = obj;
      return unreachable;
    }
  }
}

/** Typed Socket.IO handlers, e.g. io<ServerToClientEvents>() in socket.io-client. */
export const handlers: ServerToClientEvents = {
  snapshot: (objects) => objects.forEach(describe),
  'geometry:batch': ({ upserts, deletes }) => void [upserts.map(describe), deletes.length],
  status: (s) => void s.stats.ratePerSec,
};
