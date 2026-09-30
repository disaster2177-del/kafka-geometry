/**
 * Example adapter for a flat, legacy radar plot/track format:
 *
 * {
 *   "trackNo": 4711,
 *   "rng": 12.4,          // NM from own ship
 *   "brg": 045.0,         // degrees true
 *   "crs": 270,           // course, degrees
 *   "spd": 18,            // knots
 *   "ident": "H",         // F / N / U / S / H
 *   "q": 7,               // track quality
 *   "ts": 1727712000      // epoch seconds
 * }
 *
 * Copy this file as a starting point for your own formats.
 */
export default function legacyPlot(value) {
  const items = Array.isArray(value) ? value : [value];
  return items.map((p) => ({
    id: `L${p.trackNo}`,
    action: p.dropped ? 'DELETE' : 'UPSERT',
    kind: 'TRACK',
    source: p.sensor ?? 'LEGACY-RADAR',
    identity: p.ident,
    label: `L${p.trackNo}`,
    timestamp: p.ts,
    geometry: { position: { range: p.rng, bearing: p.brg } },
    properties: {
      course: p.crs,
      speed: p.spd,
      quality: p.q,
    },
  }));
}
