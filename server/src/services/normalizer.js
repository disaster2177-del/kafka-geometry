/**
 * Normalises incoming geometry messages into the canonical model used by the
 * store, the database and the UI.
 *
 * Canonical message (what the UI receives):
 * {
 *   id:         string            unique object id (track number, zone id, ...)
 *   kind:       one of KINDS
 *   action:     "UPSERT" | "DELETE"
 *   source:     string            sensor / system that produced it
 *   topic:      string            Kafka topic it arrived on
 *   identity:   one of IDENTITIES
 *   label:      string            text drawn next to the symbol
 *   timestamp:  number (epoch ms) sensor time
 *   receivedAt: number (epoch ms) server receive time
 *   ttlSec:     number | null     drop after this many seconds without update (0 = never)
 *   style:      { color, fill, fillOpacity, dashed, width }
 *   geometry:   kind specific, see normaliseGeometry()
 *   properties: free-form key/values (course, speed, altitude, rcs, ...)
 * }
 *
 * Positions are either absolute   { lat, lon }            (degrees, WGS84)
 * or relative to own ship         { range, bearing }      (NM, degrees true)
 */

export const KINDS = [
  'OWNSHIP',
  'TRACK',
  'POINT',
  'LINE',
  'POLYGON',
  'CIRCLE',
  'ELLIPSE',
  'SECTOR',
  'BEARING',
];

export const IDENTITIES = [
  'FRIEND',
  'ASSUMED_FRIEND',
  'NEUTRAL',
  'UNKNOWN',
  'PENDING',
  'SUSPECT',
  'HOSTILE',
];

const KIND_ALIASES = {
  OWN_SHIP: 'OWNSHIP',
  OWNSHIP: 'OWNSHIP',
  CONTACT: 'TRACK',
  TARGET: 'TRACK',
  PLOT: 'POINT',
  MARKER: 'POINT',
  WAYPOINT: 'POINT',
  POLYLINE: 'LINE',
  LINESTRING: 'LINE',
  ROUTE: 'LINE',
  AREA: 'POLYGON',
  ZONE: 'POLYGON',
  RANGE_RING: 'CIRCLE',
  RING: 'CIRCLE',
  UNCERTAINTY: 'ELLIPSE',
  ARC: 'SECTOR',
  COVERAGE: 'SECTOR',
  STROBE: 'BEARING',
  LOB: 'BEARING',
  LINE_OF_BEARING: 'BEARING',
};

const IDENTITY_ALIASES = {
  F: 'FRIEND',
  FRIENDLY: 'FRIEND',
  FRIEND: 'FRIEND',
  A: 'ASSUMED_FRIEND',
  ASSUMED_FRIEND: 'ASSUMED_FRIEND',
  ASSUMEDFRIEND: 'ASSUMED_FRIEND',
  N: 'NEUTRAL',
  NEUTRAL: 'NEUTRAL',
  U: 'UNKNOWN',
  UNK: 'UNKNOWN',
  UNKNOWN: 'UNKNOWN',
  P: 'PENDING',
  PENDING: 'PENDING',
  S: 'SUSPECT',
  SUSPECT: 'SUSPECT',
  H: 'HOSTILE',
  HOSTILE: 'HOSTILE',
  ENEMY: 'HOSTILE',
};

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toNum = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
const norm360 = (deg) => ((deg % 360) + 360) % 360;

function requireNum(value, field) {
  const n = toNum(value);
  if (!isNum(n)) throw new ValidationError(`"${field}" must be a number`);
  return n;
}

function optionalNum(value, field, def) {
  if (value === undefined || value === null) return def;
  return requireNum(value, field);
}

/** Convert a range expressed in various units to nautical miles. */
function rangeNm(obj, field) {
  if (obj.range !== undefined) return requireNum(obj.range, `${field}.range`);
  if (obj.rangeNm !== undefined) return requireNum(obj.rangeNm, `${field}.rangeNm`);
  if (obj.rangeKm !== undefined) return requireNum(obj.rangeKm, `${field}.rangeKm`) / 1.852;
  if (obj.rangeM !== undefined) return requireNum(obj.rangeM, `${field}.rangeM`) / 1852;
  if (obj.rangeYd !== undefined) return requireNum(obj.rangeYd, `${field}.rangeYd`) / 2025.372;
  return undefined;
}

/**
 * Accepts { lat, lon } / { latitude, longitude } / [lon, lat] (GeoJSON order)
 * or { range, bearing } (+ rangeKm / rangeM / rangeYd variants).
 */
export function normalisePosition(p, field = 'position') {
  if (p === undefined || p === null) throw new ValidationError(`"${field}" is required`);

  if (Array.isArray(p)) {
    if (p.length < 2) throw new ValidationError(`"${field}" array must be [lon, lat]`);
    return normaliseLatLon(toNum(p[1]), toNum(p[0]), field);
  }
  if (typeof p !== 'object') throw new ValidationError(`"${field}" must be an object or [lon, lat]`);

  const lat = p.lat ?? p.latitude;
  const lon = p.lon ?? p.lng ?? p.long ?? p.longitude;
  if (lat !== undefined && lon !== undefined) {
    return normaliseLatLon(toNum(lat), toNum(lon), field);
  }

  const range = rangeNm(p, field);
  const bearing = p.bearing ?? p.brg ?? p.azimuth;
  if (range !== undefined && bearing !== undefined) {
    if (range < 0) throw new ValidationError(`"${field}.range" must be >= 0`);
    return { range, bearing: norm360(requireNum(bearing, `${field}.bearing`)) };
  }

  throw new ValidationError(`"${field}" needs {lat, lon} or {range, bearing}`);
}

function normaliseLatLon(lat, lon, field) {
  if (!isNum(lat) || lat < -90 || lat > 90) throw new ValidationError(`"${field}.lat" out of range`);
  if (!isNum(lon) || lon < -180 || lon > 180) throw new ValidationError(`"${field}.lon" out of range`);
  return { lat, lon };
}

const OWNSHIP_ORIGIN = Object.freeze({ range: 0, bearing: 0 });

function normalisePoints(points, field, min) {
  if (!Array.isArray(points) || points.length < min) {
    throw new ValidationError(`"${field}" must be an array of at least ${min} positions`);
  }
  return points.map((p, i) => normalisePosition(p, `${field}[${i}]`));
}

/** Turn a GeoJSON geometry into { kind, geometry }. */
function fromGeoJson(g, requestedKind) {
  switch (g.type) {
    case 'Point':
      return {
        kind: requestedKind === 'TRACK' || requestedKind === 'OWNSHIP' ? requestedKind : 'POINT',
        geometry: { position: g.coordinates },
      };
    case 'LineString':
      return { kind: 'LINE', geometry: { points: g.coordinates } };
    case 'Polygon': {
      const ring = [...(g.coordinates?.[0] ?? [])];
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (ring.length > 3 && first && last && first[0] === last[0] && first[1] === last[1]) ring.pop();
      return { kind: 'POLYGON', geometry: { points: ring } };
    }
    default:
      throw new ValidationError(`Unsupported GeoJSON geometry type "${g.type}"`);
  }
}

export function normaliseKind(kind) {
  if (!kind) return undefined;
  const key = String(kind).trim().toUpperCase().replace(/[\s-]+/g, '_');
  const resolved = KIND_ALIASES[key] ?? key;
  if (!KINDS.includes(resolved)) throw new ValidationError(`Unknown kind "${kind}"`);
  return resolved;
}

export function normaliseIdentity(identity) {
  if (!identity) return 'UNKNOWN';
  const key = String(identity).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return IDENTITY_ALIASES[key] ?? 'UNKNOWN';
}

function normaliseTimestamp(ts, fallback) {
  if (ts === undefined || ts === null || ts === '') return fallback;
  if (isNum(ts)) return ts < 1e12 ? Math.round(ts * 1000) : ts; // seconds -> ms
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) {
    const asNum = Number(ts);
    if (isNum(asNum)) return normaliseTimestamp(asNum, fallback);
    throw new ValidationError(`Invalid timestamp "${ts}"`);
  }
  return parsed;
}

/**
 * Validate and normalise the geometry block for a given kind.
 */
export function normaliseGeometry(kind, g = {}) {
  switch (kind) {
    case 'OWNSHIP': {
      const position = normalisePosition(g.position ?? g.center ?? g, 'geometry.position');
      if (position.lat === undefined) {
        throw new ValidationError('OWNSHIP position must be absolute {lat, lon}');
      }
      return { position };
    }
    case 'TRACK':
    case 'POINT':
      return { position: normalisePosition(g.position ?? g.center ?? g, 'geometry.position') };

    case 'LINE':
      return { points: normalisePoints(g.points ?? g.coordinates, 'geometry.points', 2) };

    case 'POLYGON':
      return { points: normalisePoints(g.points ?? g.coordinates, 'geometry.points', 3) };

    case 'CIRCLE': {
      const radius = requireNum(g.radius, 'geometry.radius');
      if (radius <= 0) throw new ValidationError('"geometry.radius" must be > 0');
      return {
        center: g.center ? normalisePosition(g.center, 'geometry.center') : { ...OWNSHIP_ORIGIN },
        radius,
      };
    }

    case 'ELLIPSE': {
      const semiMajor = requireNum(g.semiMajor, 'geometry.semiMajor');
      const semiMinor = requireNum(g.semiMinor, 'geometry.semiMinor');
      if (semiMajor <= 0 || semiMinor <= 0) throw new ValidationError('Ellipse axes must be > 0');
      return {
        center: g.center ? normalisePosition(g.center, 'geometry.center') : { ...OWNSHIP_ORIGIN },
        semiMajor,
        semiMinor,
        orientation: norm360(optionalNum(g.orientation, 'geometry.orientation', 0)),
      };
    }

    case 'SECTOR': {
      const outerRadius = requireNum(g.outerRadius ?? g.radius, 'geometry.outerRadius');
      const innerRadius = optionalNum(g.innerRadius, 'geometry.innerRadius', 0);
      if (outerRadius <= 0 || innerRadius < 0 || innerRadius >= outerRadius) {
        throw new ValidationError('Sector needs 0 <= innerRadius < outerRadius');
      }
      return {
        center: g.center ? normalisePosition(g.center, 'geometry.center') : { ...OWNSHIP_ORIGIN },
        startBearing: norm360(requireNum(g.startBearing, 'geometry.startBearing')),
        endBearing: norm360(requireNum(g.endBearing, 'geometry.endBearing')),
        innerRadius,
        outerRadius,
      };
    }

    case 'BEARING': {
      const length = optionalNum(g.length, 'geometry.length', null);
      if (length !== null && length <= 0) throw new ValidationError('"geometry.length" must be > 0');
      return {
        origin: g.origin ? normalisePosition(g.origin, 'geometry.origin') : { ...OWNSHIP_ORIGIN },
        bearing: norm360(requireNum(g.bearing, 'geometry.bearing')),
        // null = draw to the edge of the scope
        length,
      };
    }

    default:
      throw new ValidationError(`Unknown kind "${kind}"`);
  }
}

function normaliseStyle(style) {
  if (!style || typeof style !== 'object') return {};
  const out = {};
  if (typeof style.color === 'string') out.color = style.color;
  if (typeof style.fill === 'string') out.fill = style.fill;
  if (isNum(toNum(style.fillOpacity))) out.fillOpacity = Math.min(1, Math.max(0, toNum(style.fillOpacity)));
  if (isNum(toNum(style.width))) out.width = toNum(style.width);
  if (style.dashed !== undefined) out.dashed = Boolean(style.dashed);
  return out;
}

/**
 * Normalise one raw message (already mapped by an adapter) into the canonical model.
 * @param {object} raw
 * @param {{ topic?: string, now?: number }} meta
 */
export function normaliseMessage(raw, meta = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('Message must be a JSON object');
  }
  const now = meta.now ?? Date.now();

  // GeoJSON Feature support: { type: "Feature", id, geometry, properties }
  let msg = raw;
  if (raw.type === 'Feature') {
    const props = raw.properties ?? {};
    msg = { ...props, id: raw.id ?? props.id, geometry: raw.geometry, properties: props.properties ?? props };
  }

  const id = msg.id ?? msg.trackId ?? msg.trackNumber;
  if (id === undefined || id === null || id === '') throw new ValidationError('"id" is required');

  const action = String(msg.action ?? 'UPSERT').toUpperCase();
  if (action !== 'UPSERT' && action !== 'DELETE') {
    throw new ValidationError(`"action" must be UPSERT or DELETE`);
  }

  let kind = normaliseKind(msg.kind ?? msg.type ?? msg.geometryType);
  const timestamp = normaliseTimestamp(msg.timestamp ?? msg.time ?? msg.ts, now);
  const base = {
    id: String(id),
    action,
    source: msg.source ? String(msg.source) : 'UNKNOWN',
    topic: meta.topic ?? null,
    timestamp,
    receivedAt: now,
  };

  if (action === 'DELETE') return { ...base, kind: kind ?? null };

  let rawGeometry = msg.geometry ?? {};
  if (typeof rawGeometry.type === 'string' && 'coordinates' in rawGeometry) {
    const converted = fromGeoJson(rawGeometry, kind);
    kind = converted.kind;
    rawGeometry = converted.geometry;
  }
  if (!kind) throw new ValidationError('"kind" is required');

  const ttl = msg.ttlSec ?? msg.ttl;
  return {
    ...base,
    kind,
    identity: normaliseIdentity(msg.identity ?? msg.classification ?? msg.affiliation),
    label: msg.label !== undefined ? String(msg.label) : String(id),
    ttlSec: ttl === undefined || ttl === null ? null : requireNum(ttl, 'ttlSec'),
    style: normaliseStyle(msg.style),
    geometry: normaliseGeometry(kind, rawGeometry),
    properties: msg.properties && typeof msg.properties === 'object' ? { ...msg.properties } : {},
  };
}
