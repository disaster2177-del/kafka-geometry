import { memo, useMemo, useRef, useState } from 'react';
import useElementSize from '../hooks/useElementSize.js';
import {
  arcPoints,
  createView,
  ellipsePoints,
  formatBearing,
  formatLat,
  formatLon,
  formatRange,
  norm360,
  offsetLocal,
  rangeBearingOf,
  toGeo,
  toLocal,
  toPath,
} from '../lib/geo.js';
import { colorOf, framePath, identityColor, isDashedIdentity } from '../lib/symbology.js';

const LABEL_MARGIN = 30;
const SYMBOL_SIZE = 8;
const AREA_KINDS = new Set(['POLYGON', 'SECTOR', 'CIRCLE', 'ELLIPSE']);
const LINE_KINDS = new Set(['LINE', 'BEARING']);

/**
 * PPI radar scope: range rings, bearing scale, sweep, own ship and every
 * geometry of the live picture, rendered as SVG.
 */
export default function RadarScope({
  objects,
  ownship,
  showOwnship = true,
  reference,
  settings,
  offset,
  onOffsetChange,
  onRangeStep,
  selectedId,
  onSelect,
  now,
}) {
  const [containerRef, size] = useElementSize();
  const [cursor, setCursor] = useState(null);
  const drag = useRef(null);

  const heading = Number(ownship?.properties?.heading ?? ownship?.properties?.course ?? 0);
  const rotation = settings.orientation === 'HEAD_UP' ? heading : 0;
  const radiusPx = Math.max(50, Math.min(size.width, size.height) / 2 - LABEL_MARGIN);

  const view = useMemo(
    () =>
      createView({
        cx: size.width / 2,
        cy: size.height / 2,
        radiusPx,
        rangeNm: settings.rangeNm,
        rotation,
        offset,
      }),
    [size.width, size.height, radiusPx, settings.rangeNm, rotation, offset],
  );

  const ready = size.width > 0 && size.height > 0;

  // --------------------------------------------------------------- interaction
  const pointer = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onMouseMove = (e) => {
    const s = pointer(e);
    if (drag.current && (drag.current.moved || Math.hypot(s.x - drag.current.start.x, s.y - drag.current.start.y) > 3)) {
      const start = drag.current.view.unproject(drag.current.start);
      const cur = drag.current.view.unproject(s);
      onOffsetChange({ x: drag.current.offset.x - (cur.x - start.x), y: drag.current.offset.y - (cur.y - start.y) });
      drag.current.moved = true;
    }
    setCursor(view.unproject(s));
  };

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    // Objects stop propagation on mousedown, so reaching here means empty scope.
    drag.current = { start: pointer(e), offset, view, moved: false };
  };

  const onMouseUp = () => {
    if (drag.current && !drag.current.moved) onSelect(null);
    drag.current = null;
  };

  const onWheel = (e) => onRangeStep(e.deltaY > 0 ? 1 : -1);

  const select = (id) => (e) => {
    e.stopPropagation();
    onSelect(id);
  };

  // --------------------------------------------------------------- render
  const sorted = useMemo(() => {
    const rank = (o) => (AREA_KINDS.has(o.kind) ? 0 : LINE_KINDS.has(o.kind) ? 1 : 2);
    return [...objects].sort((a, b) => rank(a) - rank(b));
  }, [objects]);

  const ownshipAge = ownship ? (now - ownship.receivedAt) / 1000 : null;
  const cursorRB = cursor ? rangeBearingOf(cursor) : null;
  const cursorGeo = cursor && reference ? toGeo(cursor, reference) : null;
  const originScreen = ready ? view.project({ x: 0, y: 0 }) : null;

  return (
    <div className="scope" ref={containerRef}>
      {ready && (
        <svg
          width={size.width}
          height={size.height}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onMouseLeave={() => {
            drag.current = null;
            setCursor(null);
          }}
          onWheel={onWheel}
        >
          <defs>
            <clipPath id="scope-clip">
              <circle cx={view.cx} cy={view.cy} r={radiusPx} />
            </clipPath>
            <radialGradient id="scope-bg">
              <stop offset="0%" stopColor="#0b2230" />
              <stop offset="100%" stopColor="#050d14" />
            </radialGradient>
          </defs>

          <circle
            cx={view.cx}
            cy={view.cy}
            r={radiusPx}
            fill="url(#scope-bg)"
            className="scope-face"
          />

          <g clipPath="url(#scope-clip)">
            <RangeRings view={view} />
            {settings.showSweep && <Sweep view={view} />}

            {sorted.map((o) => (
              <GeometryShape
                key={o.id}
                obj={o}
                view={view}
                reference={reference}
                settings={settings}
                selected={o.id === selectedId}
                onSelect={select(o.id)}
                now={now}
              />
            ))}

            {ownship && showOwnship && (
              <OwnShip
                view={view}
                heading={heading}
                speed={Number(ownship.properties?.speed ?? 0)}
                settings={settings}
                selected={ownship.id === selectedId}
                onSelect={select(ownship.id)}
              />
            )}
          </g>

          <BearingScale view={view} />

          {originScreen && Math.hypot(originScreen.x - view.cx, originScreen.y - view.cy) > radiusPx && (
            <text x={view.cx} y={view.cy + radiusPx - 12} className="scope-warning" textAnchor="middle">
              OWN SHIP OFF SCOPE - press C to re-centre
            </text>
          )}
        </svg>
      )}

      <div className="scope-overlay top-left">
        <div>
          RANGE <b>{settings.rangeNm} NM</b> · RINGS {ringStep(settings.rangeNm)} NM
        </div>
        <div>{settings.orientation === 'HEAD_UP' ? 'HEAD UP' : 'NORTH UP'}</div>
        {(offset.x !== 0 || offset.y !== 0) && <div className="warn">OFF-CENTRED</div>}
      </div>

      <div className="scope-overlay top-right">
        {ownship ? (
          <>
            <div>
              HDG <b>{formatBearing(heading)}</b> SPD <b>{Number(ownship.properties?.speed ?? 0).toFixed(1)} KN</b>
            </div>
            <div>
              {formatLat(ownship.geometry.position.lat)} {formatLon(ownship.geometry.position.lon)}
            </div>
            {ownshipAge > 10 && <div className="warn">OWN SHIP DATA STALE ({Math.round(ownshipAge)}s)</div>}
          </>
        ) : (
          <div className="warn">NO OWN SHIP DATA{reference ? ' - using reference point' : ''}</div>
        )}
      </div>

      {cursorRB && (
        <div className="scope-overlay bottom-left">
          <div>
            CURSOR {formatBearing(cursorRB.bearing)} / {formatRange(cursorRB.range)}
          </div>
          {cursorGeo && (
            <div>
              {formatLat(cursorGeo.lat)} {formatLon(cursorGeo.lon)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ helpers

export function ringStep(rangeNm) {
  const candidates = [0.25, 0.5, 1, 2, 3, 5, 10, 20, 25, 50, 100];
  return candidates.find((c) => rangeNm / c <= 6) ?? rangeNm / 4;
}

export const RangeRings = memo(function RangeRings({ view }) {
  const step = ringStep(view.rangeNm);
  const origin = view.project({ x: 0, y: 0 });
  const rings = [];
  for (let r = step; r <= view.rangeNm * 2.5; r += step) rings.push(r);
  return (
    <g className="range-rings">
      {rings.map((r) => (
        <g key={r}>
          <circle cx={origin.x} cy={origin.y} r={r * view.scale} />
          <text x={origin.x + 3} y={origin.y - r * view.scale + 11}>
            {r}
          </text>
        </g>
      ))}
      {[0, 30, 60, 90, 120, 150].map((b) => {
        const a = view.project(offsetLocal({ x: 0, y: 0 }, b, view.rangeNm * 3));
        const c = view.project(offsetLocal({ x: 0, y: 0 }, b + 180, view.rangeNm * 3));
        return <line key={b} x1={a.x} y1={a.y} x2={c.x} y2={c.y} />;
      })}
    </g>
  );
});

export function BearingScale({ view }) {
  const ticks = [];
  for (let b = 0; b < 360; b += 5) {
    const a = (view.screenAngle(b) * Math.PI) / 180;
    const major = b % 30 === 0;
    const r1 = view.radiusPx;
    const r2 = view.radiusPx + (major ? 8 : b % 10 === 0 ? 5 : 3);
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    ticks.push(
      <line
        key={`t${b}`}
        x1={view.cx + r1 * sin}
        y1={view.cy - r1 * cos}
        x2={view.cx + r2 * sin}
        y2={view.cy - r2 * cos}
        className={major ? 'major' : undefined}
      />,
    );
    if (major) {
      const rl = view.radiusPx + 19;
      ticks.push(
        <text key={`l${b}`} x={view.cx + rl * sin} y={view.cy - rl * cos} textAnchor="middle" dominantBaseline="middle">
          {String(b).padStart(3, '0')}
        </text>,
      );
    }
  }
  return (
    <g className="bearing-scale">
      <circle cx={view.cx} cy={view.cy} r={view.radiusPx} className="scope-edge" />
      {ticks}
    </g>
  );
}

const SWEEP_WEDGES = 14;
export function Sweep({ view }) {
  const origin = view.project({ x: 0, y: 0 });
  const r = view.radiusPx * 3;
  const wedges = [];
  for (let i = 0; i < SWEEP_WEDGES; i += 1) {
    const a1 = (-(i + 1) * 2 * Math.PI) / 180;
    const a2 = (-i * 2 * Math.PI) / 180;
    wedges.push(
      <path
        key={i}
        d={`M${origin.x},${origin.y} L${origin.x + r * Math.sin(a1)},${origin.y - r * Math.cos(a1)} A${r},${r} 0 0 1 ${origin.x + r * Math.sin(a2)},${origin.y - r * Math.cos(a2)}Z`}
        fillOpacity={0.22 * (1 - i / SWEEP_WEDGES)}
      />,
    );
  }
  return (
    <g className="sweep">
      {wedges}
      <line x1={origin.x} y1={origin.y} x2={origin.x} y2={origin.y - r} />
      <animateTransform
        attributeName="transform"
        type="rotate"
        from={`0 ${origin.x} ${origin.y}`}
        to={`360 ${origin.x} ${origin.y}`}
        dur="4s"
        repeatCount="indefinite"
      />
    </g>
  );
}

export function OwnShip({ view, heading, speed, settings, selected, onSelect }) {
  const p = view.project({ x: 0, y: 0 });
  const headEnd = view.project(offsetLocal({ x: 0, y: 0 }, heading, view.rangeNm * 3));
  const leaderEnd = view.project(offsetLocal({ x: 0, y: 0 }, heading, (speed * settings.leaderMinutes) / 60));
  const angle = view.screenAngle(heading);
  return (
    <g className="ownship" onMouseDown={onSelect}>
      <line x1={p.x} y1={p.y} x2={headEnd.x} y2={headEnd.y} className="heading-line" />
      {settings.showLeaders && <line x1={p.x} y1={p.y} x2={leaderEnd.x} y2={leaderEnd.y} className="leader" />}
      <g transform={`translate(${p.x},${p.y}) rotate(${angle})`}>
        <path d="M0,-11 L6,4 L6,9 L-6,9 L-6,4Z" />
      </g>
      {selected && <SelectionBox x={p.x} y={p.y} />}
    </g>
  );
}

export function SelectionBox({ x, y, s = 14 }) {
  const c = s * 0.45;
  return (
    <path
      className="selection"
      d={[
        `M${x - s},${y - s + c} V${y - s} H${x - s + c}`,
        `M${x + s - c},${y - s} H${x + s} V${y - s + c}`,
        `M${x + s},${y + s - c} V${y + s} H${x + s - c}`,
        `M${x - s + c},${y + s} H${x - s} V${y + s - c}`,
      ].join(' ')}
    />
  );
}

export function Label({ x, y, children, color }) {
  return (
    <text x={x} y={y} className="obj-label" fill={color}>
      {children}
    </text>
  );
}

/** Draws one object of the live picture. */
function GeometryShape({ obj, view, reference, settings, selected, onSelect, now }) {
  const g = obj.geometry;
  const color = colorOf(obj);
  const dashed = obj.style?.dashed;
  const width = obj.style?.width ?? (selected ? 2.5 : 1.5);
  const stale = obj.ttlSec !== 0 && now - obj.receivedAt > 15_000;
  const common = {
    stroke: color,
    strokeWidth: width,
    strokeDasharray: dashed ? '6 4' : undefined,
    fill: obj.style?.fill ?? 'none',
    fillOpacity: obj.style?.fill ? (obj.style.fillOpacity ?? 0.15) : undefined,
    opacity: stale ? 0.45 : 1,
  };
  const local = (p) => toLocal(p, reference);
  const proj = (p) => {
    const l = local(p);
    return l ? view.project(l) : null;
  };

  switch (obj.kind) {
    case 'TRACK':
    case 'POINT': {
      const l = local(g.position);
      if (!l) return null;
      const p = view.project(l);
      const idColor = obj.style?.color ?? identityColor(obj.identity);
      const course = Number(obj.properties?.course ?? obj.properties?.cog ?? obj.properties?.heading);
      const speed = Number(obj.properties?.speed ?? obj.properties?.sog ?? 0);
      const air = String(obj.properties?.domain ?? '').toUpperCase() === 'AIR';
      return (
        <g className="obj" onMouseDown={onSelect} opacity={stale ? 0.45 : 1}>
          {obj.kind === 'TRACK' && settings.showTrails &&
            obj.trail?.map((t, i) => {
              const tp = proj(t.position);
              return tp ? <circle key={i} cx={tp.x} cy={tp.y} r={1.4} fill={idColor} opacity={(0.25 + (0.6 * i) / obj.trail.length)} /> : null;
            })}
          {obj.kind === 'TRACK' && settings.showLeaders && Number.isFinite(course) && speed > 0 && (() => {
            const e = view.project(offsetLocal(l, course, (speed * settings.leaderMinutes) / 60));
            return <line x1={p.x} y1={p.y} x2={e.x} y2={e.y} stroke={idColor} strokeWidth={1.3} />;
          })()}
          {obj.kind === 'TRACK' ? (
            <path
              d={framePath(obj.identity, SYMBOL_SIZE, air)}
              transform={`translate(${p.x},${p.y})`}
              stroke={idColor}
              strokeWidth={selected ? 2.4 : 1.8}
              strokeDasharray={isDashedIdentity(obj.identity) ? '3 2' : undefined}
              fill="rgba(5,13,20,0.6)"
            />
          ) : (
            <g transform={`translate(${p.x},${p.y})`} stroke={idColor} strokeWidth={1.6}>
              <circle r={5} fill="none" />
              <path d="M-9,0 H-5 M5,0 H9 M0,-9 V-5 M0,5 V9" />
            </g>
          )}
          <circle cx={p.x} cy={p.y} r={SYMBOL_SIZE + 4} className="hit" />
          {selected && <SelectionBox x={p.x} y={p.y} />}
          {settings.showLabels && (
            <Label x={p.x + SYMBOL_SIZE + 4} y={p.y - SYMBOL_SIZE} color={idColor}>
              {obj.label}
            </Label>
          )}
        </g>
      );
    }

    case 'LINE':
    case 'POLYGON': {
      const pts = g.points.map(proj).filter(Boolean);
      if (pts.length < 2) return null;
      const closed = obj.kind === 'POLYGON';
      const d = toPath(pts, closed);
      const anchor = pts[0];
      return (
        <g className="obj" onMouseDown={onSelect}>
          <path d={d} {...common} fill={closed ? common.fill : 'none'} />
          <path d={d} className="hit-stroke" />
          {selected && pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={3} fill={color} />)}
          {settings.showLabels && <Label x={anchor.x + 6} y={anchor.y - 6} color={color}>{obj.label}</Label>}
        </g>
      );
    }

    case 'CIRCLE': {
      const c = local(g.center);
      if (!c) return null;
      const p = view.project(c);
      const r = g.radius * view.scale;
      const top = view.project(offsetLocal(c, norm360(view.rotation), g.radius));
      return (
        <g className="obj" onMouseDown={onSelect}>
          <circle cx={p.x} cy={p.y} r={r} {...common} />
          <circle cx={p.x} cy={p.y} r={r} className="hit-stroke" />
          {settings.showLabels && <Label x={top.x + 4} y={top.y - 4} color={color}>{obj.label}</Label>}
        </g>
      );
    }

    case 'ELLIPSE': {
      const c = local(g.center);
      if (!c) return null;
      const d = toPath(ellipsePoints(c, g.semiMajor, g.semiMinor, g.orientation).map(view.project), true);
      const tip = view.project(offsetLocal(c, g.orientation, g.semiMajor));
      return (
        <g className="obj" onMouseDown={onSelect}>
          <path d={d} {...common} />
          <path d={d} className="hit-stroke" />
          {settings.showLabels && <Label x={tip.x + 4} y={tip.y - 4} color={color}>{obj.label}</Label>}
        </g>
      );
    }

    case 'SECTOR': {
      const c = local(g.center);
      if (!c) return null;
      const outer = arcPoints(c, g.outerRadius, g.startBearing, g.endBearing);
      const inner = g.innerRadius > 0 ? arcPoints(c, g.innerRadius, g.startBearing, g.endBearing).reverse() : [c];
      const full = norm360(g.endBearing - g.startBearing) === 0;
      const d = full ? toPath(outer.map(view.project), true) : toPath([...outer, ...inner].map(view.project), true);
      const mid = view.project(
        offsetLocal(c, g.startBearing + (norm360(g.endBearing - g.startBearing) || 360) / 2, g.outerRadius),
      );
      return (
        <g className="obj" onMouseDown={onSelect}>
          <path d={d} {...common} />
          <path d={d} className="hit-stroke" />
          {settings.showLabels && <Label x={mid.x + 4} y={mid.y} color={color}>{obj.label}</Label>}
        </g>
      );
    }

    case 'BEARING': {
      const o = local(g.origin);
      if (!o) return null;
      const len = g.length ?? view.rangeNm * 3;
      const a = view.project(o);
      const b = view.project(offsetLocal(o, g.bearing, len));
      const lbl = view.project(offsetLocal(o, g.bearing, Math.min(len, view.rangeNm * 0.85)));
      return (
        <g className="obj" onMouseDown={onSelect}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} strokeDasharray={dashed ? '6 4' : '10 3 2 3'} />
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="hit-stroke" />
          {settings.showLabels && (
            <Label x={lbl.x + 6} y={lbl.y} color={color}>
              {obj.label} {formatBearing(g.bearing)}
            </Label>
          )}
        </g>
      );
    }

    default:
      return null;
  }
}
