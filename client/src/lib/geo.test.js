import { describe, expect, it } from 'vitest';
import { arcPoints, createView, ellipsePoints, rangeBearingOf, toGeo, toLocal } from './geo.js';

const close = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('geo', () => {
  it('relative positions become local NM', () => {
    const p = toLocal({ range: 10, bearing: 90 });
    close(p.x, 10);
    close(p.y, 0);
  });

  it('absolute positions round-trip through local coordinates', () => {
    const ref = { lat: 36.5, lon: 15.2 };
    const g = { lat: 36.7, lon: 15.5 };
    const back = toGeo(toLocal(g, ref), ref);
    close(back.lat, g.lat);
    close(back.lon, g.lon);
    close(toLocal({ lat: 37.5, lon: 15.2 }, ref).y, 60); // 1 deg lat = 60 NM
  });

  it('range/bearing of local points', () => {
    const rb = rangeBearingOf({ x: -5, y: 0 });
    close(rb.range, 5);
    close(rb.bearing, 270);
  });

  it('north-up view puts north at the top', () => {
    const v = createView({ cx: 100, cy: 100, radiusPx: 100, rangeNm: 10 });
    const s = v.project({ x: 0, y: 10 });
    close(s.x, 100);
    close(s.y, 0);
  });

  it('head-up view puts the heading at the top and unproject inverts project', () => {
    const v = createView({ cx: 100, cy: 100, radiusPx: 100, rangeNm: 10, rotation: 90, offset: { x: 1, y: 2 } });
    const east = v.project({ x: 11, y: 2 }); // 10 NM east of the view centre
    close(east.x, 100);
    close(east.y, 0);
    const back = v.unproject(v.project({ x: 3.3, y: -4.4 }));
    close(back.x, 3.3);
    close(back.y, -4.4);
  });

  it('arcs sweep clockwise across north', () => {
    const pts = arcPoints({ x: 0, y: 0 }, 1, 350, 10, 5);
    expect(pts.length).toBe(5);
    close(rangeBearingOf(pts[2]).bearing, 0);
  });

  it('ellipse major axis follows orientation', () => {
    const pts = ellipsePoints({ x: 0, y: 0 }, 4, 1, 90, 4);
    close(pts[0].x, 4);
    close(pts[0].y, 0);
  });
});
