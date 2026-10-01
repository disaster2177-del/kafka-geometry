import { describe, expect, it } from 'vitest';
import { buildShape, createAeqd, toLonLat, zoneAlerts } from './turfGeo.js';
import { rangeBearingOf } from './geo.js';

const OWN = [15.2, 36.5];
const near = (a, b, eps) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('turfGeo', () => {
  it('relative positions resolve to lon/lat and project back to the same range/bearing', () => {
    const aeqd = createAeqd(OWN);
    for (const [range, bearing] of [[5, 45], [96, 200], [192, 330]]) {
      const ll = toLonLat({ range, bearing }, OWN);
      const rb = rangeBearingOf(aeqd.toLocal(ll));
      near(rb.range, range, 1e-6); // exact at any distance
      near(rb.bearing, bearing, 1e-6);
    }
  });

  it('AEQD inverse round-trips', () => {
    const aeqd = createAeqd(OWN);
    const ll = aeqd.toLonLat({ x: 30, y: -40 });
    const back = aeqd.toLocal(ll);
    near(back.x, 30, 1e-6);
    near(back.y, -40, 1e-6);
  });

  it('circle and ellipse rings have the right size and orientation', () => {
    const aeqd = createAeqd(OWN);
    const c = buildShape({ kind: 'CIRCLE', geometry: { center: { range: 0, bearing: 0 }, radius: 10 } }, OWN);
    for (const p of c.ring) near(rangeBearingOf(aeqd.toLocal(p)).range, 10, 1e-3);

    const e = buildShape(
      { kind: 'ELLIPSE', geometry: { center: { range: 0, bearing: 0 }, semiMajor: 4, semiMinor: 1, orientation: 30 } },
      OWN,
    );
    const far = e.ring.map((p) => rangeBearingOf(aeqd.toLocal(p))).sort((a, b) => b.range - a.range)[0];
    near(far.range, 4, 1e-2);
    expect([30, 210].some((b) => Math.abs(far.bearing - b) < 3)).toBe(true);
  });

  it('sector ring follows the arc clockwise across north', () => {
    const aeqd = createAeqd(OWN);
    const s = buildShape(
      { kind: 'SECTOR', geometry: { center: { range: 0, bearing: 0 }, startBearing: 350, endBearing: 10, innerRadius: 0, outerRadius: 20 } },
      OWN,
    );
    const outer = s.ring.map((p) => rangeBearingOf(aeqd.toLocal(p))).filter((rb) => rb.range > 19);
    expect(outer.every((rb) => rb.bearing >= 349.9 || rb.bearing <= 10.1)).toBe(true);
    expect(s.ring[0]).toEqual(s.ring[s.ring.length - 1]);
  });

  it('zone alerts: threat tracks inside polygons and friendly circles', () => {
    const objects = [
      { id: 'WEZ', kind: 'CIRCLE', identity: 'FRIEND', label: 'WEZ', geometry: { center: { range: 0, bearing: 0 }, radius: 10 } },
      { id: 'THREAT', kind: 'CIRCLE', identity: 'HOSTILE', label: 'THREAT', geometry: { center: { range: 0, bearing: 0 }, radius: 50 } },
      { id: 'BOX', kind: 'POLYGON', identity: 'NEUTRAL', label: 'BOX', geometry: { points: [{ range: 14, bearing: 320 }, { range: 20, bearing: 335 }, { range: 17, bearing: 355 }, { range: 11, bearing: 340 }] } },
      { id: 'H1', kind: 'TRACK', identity: 'HOSTILE', label: 'H1', geometry: { position: { range: 5, bearing: 90 } }, properties: {} },
      { id: 'H2', kind: 'TRACK', identity: 'SUSPECT', label: 'H2', geometry: { position: { range: 15, bearing: 338 } }, properties: {} },
      { id: 'F1', kind: 'TRACK', identity: 'FRIEND', label: 'F1', geometry: { position: { range: 5, bearing: 90 } }, properties: {} },
      { id: 'N1', kind: 'TRACK', identity: 'NEUTRAL', label: 'N1', geometry: { position: { range: 4, bearing: 10 } }, properties: {} },
      { id: 'U1', kind: 'TRACK', identity: 'UNKNOWN', label: 'U1', geometry: { position: { range: 30, bearing: 90 } }, properties: {} },
    ];
    const shapes = new Map(objects.map((o) => [o.id, buildShape(o, OWN)]));
    const pairs = zoneAlerts(objects, shapes).map((a) => `${a.trackId}>${a.zoneId}`).sort();
    // F1 friendly and N1 neutral don't alert, U1 is outside, THREAT is not a friendly zone
    expect(pairs).toEqual(['H1>WEZ', 'H2>BOX']);
  });
});
