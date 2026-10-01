/**
 * Turf.js geometry engine for the PPI scope (used by TurfRadarScope).
 *
 * Differences from the classic engine in geo.js:
 *  - Every position is resolved to WGS84 lon/lat first (relative range/bearing
 *    positions via a geodesic destination from own ship).
 *  - Shapes (circles, ellipses, sectors, bearing lines) are built by Turf as
 *    GeoJSON in lon/lat, so they are geodesically correct.
 *  - lon/lat is projected to the scope with an azimuthal equidistant projection
 *    centred on own ship: the true radar picture, where range and bearing from
 *    own ship are exact at any distance.
 *  - Zone alerts: tracks inside areas, via point-in-polygon.
 */
import { point, polygon } from '@turf/helpers';
import distance from '@turf/distance';
import bearing from '@turf/bearing';
import destination from '@turf/destination';
import circle from '@turf/circle';
import ellipse from '@turf/ellipse';
import lineArc from '@turf/line-arc';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { norm360, toRad } from './geo.js';

const NM = { units: 'nauticalmiles' };

/** Turf polygons need a closed ring (last position equal to the first). */
function closeRing(ring) {
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
}
const ARC_STEPS = 72;
const LINE_SAMPLES = 32;

/** Position (canonical {lat, lon} or {range, bearing}) -> [lon, lat]. Relative positions need own ship. */
export function toLonLat(pos, own) {
  if (!pos) return null;
  if (pos.lat !== undefined) return [pos.lon, pos.lat];
  if (!own) return null;
  return destination(point(own), pos.range, pos.bearing, NM).geometry.coordinates;
}

/**
 * Azimuthal equidistant projection centred on `own` ([lon, lat]).
 * Local coordinates are NM east/north, matching createView() in geo.js.
 */
export function createAeqd(own) {
  const origin = point(own);
  return {
    toLocal([lon, lat]) {
      const d = distance(origin, [lon, lat], NM);
      if (d === 0) return { x: 0, y: 0 };
      const b = toRad(bearing(origin, [lon, lat]));
      return { x: d * Math.sin(b), y: d * Math.cos(b) };
    },
    toLonLat({ x, y }) {
      const d = Math.hypot(x, y);
      if (d === 0) return own;
      return destination(origin, d, norm360((Math.atan2(x, y) * 180) / Math.PI), NM).geometry.coordinates;
    },
  };
}

/** Points along the geodesic from `start` for `length` NM on an initial bearing. */
function geodesicLine(start, initialBearing, length) {
  const coords = [start];
  for (let i = 1; i <= LINE_SAMPLES; i += 1) {
    coords.push(destination(point(start), (length * i) / LINE_SAMPLES, initialBearing, NM).geometry.coordinates);
  }
  return coords;
}

function sectorRing(center, g) {
  const full = norm360(g.endBearing - g.startBearing) === 0;
  const outer = lineArc(point(center), g.outerRadius, g.startBearing, g.endBearing, { ...NM, steps: ARC_STEPS })
    .geometry.coordinates;
  if (full) return closeRing(outer);
  const inner =
    g.innerRadius > 0
      ? lineArc(point(center), g.innerRadius, g.startBearing, g.endBearing, { ...NM, steps: ARC_STEPS })
          .geometry.coordinates.slice()
          .reverse()
      : [center];
  return [...outer, ...inner, outer[0]];
}

/**
 * Build the drawable GeoJSON-style geometry (lon/lat) for one canonical object.
 * @returns {null | { type: 'point', coord, trail, leader }
 *                 | { type: 'line', coords }
 *                 | { type: 'area', ring, labelAt }}
 */
export function buildShape(obj, own, { leaderMinutes = 6, bearingLength = 50 } = {}) {
  const g = obj.geometry;
  switch (obj.kind) {
    case 'TRACK':
    case 'POINT': {
      const coord = toLonLat(g.position, own);
      if (!coord) return null;
      const course = Number(obj.properties?.course ?? obj.properties?.cog ?? obj.properties?.heading);
      const speed = Number(obj.properties?.speed ?? obj.properties?.sog ?? 0);
      const leader =
        obj.kind === 'TRACK' && Number.isFinite(course) && speed > 0
          ? destination(point(coord), (speed * leaderMinutes) / 60, course, NM).geometry.coordinates
          : null;
      const trail = (obj.trail ?? []).map((t) => toLonLat(t.position, own)).filter(Boolean);
      return { type: 'point', coord, trail, leader };
    }
    case 'LINE': {
      const coords = g.points.map((p) => toLonLat(p, own)).filter(Boolean);
      return coords.length >= 2 ? { type: 'line', coords } : null;
    }
    case 'POLYGON': {
      const coords = g.points.map((p) => toLonLat(p, own)).filter(Boolean);
      return coords.length >= 3 ? { type: 'area', ring: [...coords, coords[0]], labelAt: coords[0] } : null;
    }
    case 'CIRCLE': {
      const c = toLonLat(g.center, own);
      if (!c) return null;
      const ring = circle(point(c), g.radius, { ...NM, steps: ARC_STEPS }).geometry.coordinates[0];
      return { type: 'area', ring, labelAt: destination(point(c), g.radius, 0, NM).geometry.coordinates };
    }
    case 'ELLIPSE': {
      const c = toLonLat(g.center, own);
      if (!c) return null;
      // Turf's angle is measured clockwise from east: major-axis bearing = angle + 90.
      const ring = ellipse(point(c), g.semiMajor, g.semiMinor, { ...NM, angle: g.orientation - 90, steps: ARC_STEPS })
        .geometry.coordinates[0];
      return { type: 'area', ring, labelAt: destination(point(c), g.semiMajor, g.orientation, NM).geometry.coordinates };
    }
    case 'SECTOR': {
      const c = toLonLat(g.center, own);
      if (!c) return null;
      const mid = g.startBearing + (norm360(g.endBearing - g.startBearing) || 360) / 2;
      return {
        type: 'area',
        ring: sectorRing(c, g),
        labelAt: destination(point(c), g.outerRadius, mid, NM).geometry.coordinates,
      };
    }
    case 'BEARING': {
      const o = toLonLat(g.origin, own);
      if (!o) return null;
      return { type: 'line', coords: geodesicLine(o, g.bearing, g.length ?? bearingLength) };
    }
    default:
      return null;
  }
}

const AREA_ALERT_KINDS = new Set(['POLYGON', 'CIRCLE', 'ELLIPSE', 'SECTOR']);
const OWN_FORCES = new Set(['FRIEND', 'ASSUMED_FRIEND']);
/** Identities that raise alerts; friends and neutrals (e.g. AIS merchants) don't. */
const THREAT_IDENTITIES = new Set(['HOSTILE', 'SUSPECT', 'UNKNOWN', 'PENDING']);

/**
 * Zone alerts: every hostile / suspect / unknown / pending track that lies inside an area.
 * Areas checked: any POLYGON (zones, boxes) and friendly CIRCLE / ELLIPSE / SECTOR
 * (weapon engagement zones, coverage and blind arcs).
 * @param {object[]} objects  canonical objects
 * @param {Map<string, object>} shapes  id -> buildShape() result
 */
export function zoneAlerts(objects, shapes) {
  const zones = objects
    .filter((o) => AREA_ALERT_KINDS.has(o.kind) && (o.kind === 'POLYGON' || OWN_FORCES.has(o.identity)))
    .map((o) => ({ obj: o, shape: shapes.get(o.id) }))
    .filter((z) => z.shape?.type === 'area' && z.shape.ring.length >= 4)
    .flatMap((z) => {
      try {
        return [{ ...z, poly: polygon([closeRing(z.shape.ring)]) }];
      } catch {
        return []; // degenerate ring: skip rather than break the scope
      }
    });

  const alerts = [];
  for (const t of objects) {
    if (t.kind !== 'TRACK' || !THREAT_IDENTITIES.has(t.identity)) continue;
    const s = shapes.get(t.id);
    if (!s) continue;
    for (const z of zones) {
      if (booleanPointInPolygon(point(s.coord), z.poly)) {
        alerts.push({ trackId: t.id, trackLabel: t.label, identity: t.identity, zoneId: z.obj.id, zoneLabel: z.obj.label });
      }
    }
  }
  return alerts;
}
