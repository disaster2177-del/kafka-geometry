/**
 * Coordinate handling for the PPI (plan position indicator) scope.
 *
 * Three coordinate systems:
 *  - geographic   { lat, lon }            degrees WGS84
 *  - relative     { range, bearing }      NM / degrees true from own ship
 *  - local        { x, y }                NM east / north of the reference point (own ship)
 *  - screen       { x, y }                pixels (y down)
 *
 * A local tangent-plane (equirectangular) projection is used. The error is
 * negligible at radar ranges (< 0.5 % at 200 NM at mid latitudes).
 */

export const toRad = (d) => (d * Math.PI) / 180;
export const toDeg = (r) => (r * 180) / Math.PI;
export const norm360 = (d) => ((d % 360) + 360) % 360;

const NM_PER_DEG_LAT = 60;

/** Convert any supported position into local NM coordinates relative to `ref` ({lat, lon}). */
export function toLocal(pos, ref) {
  if (!pos) return null;
  if (pos.range !== undefined) {
    const b = toRad(pos.bearing);
    return { x: pos.range * Math.sin(b), y: pos.range * Math.cos(b) };
  }
  if (!ref) return null;
  return {
    x: (pos.lon - ref.lon) * NM_PER_DEG_LAT * Math.cos(toRad(ref.lat)),
    y: (pos.lat - ref.lat) * NM_PER_DEG_LAT,
  };
}

/** Local NM -> geographic. */
export function toGeo(local, ref) {
  if (!ref) return null;
  return {
    lat: ref.lat + local.y / NM_PER_DEG_LAT,
    lon: ref.lon + local.x / (NM_PER_DEG_LAT * Math.cos(toRad(ref.lat))),
  };
}

/** Point `dist` NM along `bearing` from a local point. */
export function offsetLocal(p, bearing, dist) {
  const b = toRad(bearing);
  return { x: p.x + dist * Math.sin(b), y: p.y + dist * Math.cos(b) };
}

export function rangeBearingOf(local) {
  return { range: Math.hypot(local.x, local.y), bearing: norm360(toDeg(Math.atan2(local.x, local.y))) };
}

/**
 * Creates the local <-> screen transform for the scope.
 * @param {object} o
 * @param {number} o.cx         scope centre, px
 * @param {number} o.cy
 * @param {number} o.radiusPx   scope radius, px
 * @param {number} o.rangeNm    range at the scope edge
 * @param {number} o.rotation   picture rotation in degrees (own ship heading for head-up, 0 for north-up)
 * @param {{x:number,y:number}} o.offset  local point shown at the centre (pan), NM
 */
export function createView({ cx, cy, radiusPx, rangeNm, rotation = 0, offset = { x: 0, y: 0 } }) {
  const scale = radiusPx / rangeNm;
  const r = toRad(rotation);
  const cos = Math.cos(r);
  const sin = Math.sin(r);

  return {
    cx,
    cy,
    radiusPx,
    rangeNm,
    rotation,
    scale,
    offset,
    /** local NM -> screen px */
    project(p) {
      const dx = p.x - offset.x;
      const dy = p.y - offset.y;
      // rotate counter-clockwise by the heading so the heading points up
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return { x: cx + rx * scale, y: cy - ry * scale };
    },
    /** screen px -> local NM */
    unproject(s) {
      const rx = (s.x - cx) / scale;
      const ry = (cy - s.y) / scale;
      return { x: rx * cos + ry * sin + offset.x, y: -rx * sin + ry * cos + offset.y };
    },
    /** true bearing -> screen angle (deg clockwise from up) */
    screenAngle(bearing) {
      return norm360(bearing - rotation);
    },
  };
}

/** Sample an arc (clockwise from start to end bearing) around a local centre. */
export function arcPoints(center, radius, startBearing, endBearing, stepDeg = 2) {
  let sweep = norm360(endBearing - startBearing);
  if (sweep === 0) sweep = 360;
  const steps = Math.max(2, Math.ceil(sweep / stepDeg));
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    pts.push(offsetLocal(center, startBearing + (sweep * i) / steps, radius));
  }
  return pts;
}

/** Sample an ellipse; orientation = bearing of the major axis. */
export function ellipsePoints(center, semiMajor, semiMinor, orientation, steps = 72) {
  const o = toRad(orientation);
  const pts = [];
  for (let i = 0; i < steps; i += 1) {
    const t = (2 * Math.PI * i) / steps;
    // along-axis (a) and cross-axis (b) components, then rotate to bearing
    const a = semiMajor * Math.cos(t);
    const b = semiMinor * Math.sin(t);
    pts.push({
      x: center.x + a * Math.sin(o) + b * Math.cos(o),
      y: center.y + a * Math.cos(o) - b * Math.sin(o),
    });
  }
  return pts;
}

export const toPath = (pts, close = false) =>
  pts.length ? `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}${close ? 'Z' : ''}` : '';

export function formatLat(lat) {
  const h = lat >= 0 ? 'N' : 'S';
  const a = Math.abs(lat);
  const d = Math.floor(a);
  return `${String(d).padStart(2, '0')}°${((a - d) * 60).toFixed(2).padStart(5, '0')}'${h}`;
}

export function formatLon(lon) {
  const h = lon >= 0 ? 'E' : 'W';
  const a = Math.abs(lon);
  const d = Math.floor(a);
  return `${String(d).padStart(3, '0')}°${((a - d) * 60).toFixed(2).padStart(5, '0')}'${h}`;
}

export const formatBearing = (b) => `${String(Math.round(norm360(b)) % 360).padStart(3, '0')}°`;
export const formatRange = (r) => `${r < 10 ? r.toFixed(2) : r.toFixed(1)} NM`;
