import { useMemo, useRef, useState } from 'react';
import useElementSize from '../hooks/useElementSize.js';
import { createView, formatBearing, formatLat, formatLon, formatRange, rangeBearingOf, toPath } from '../lib/geo.js';
import { buildShape, createAeqd, zoneAlerts } from '../lib/turfGeo.js';
import { colorOf, framePath, identityColor, isDashedIdentity } from '../lib/symbology.js';
import { BearingScale, Label, OwnShip, RangeRings, SelectionBox, Sweep, ringStep } from './RadarScope.jsx';

const LABEL_MARGIN = 30;
const SYMBOL_SIZE = 8;
const AREA_KINDS = new Set(['POLYGON', 'SECTOR', 'CIRCLE', 'ELLIPSE']);
const LINE_KINDS = new Set(['LINE', 'BEARING']);

/**
 * PPI scope drawn with the Turf.js engine (see lib/turfGeo.js):
 * geodesic shapes, azimuthal equidistant projection around own ship, and
 * zone-entry alerts. Same props as RadarScope, so the two are interchangeable.
 */
export default function TurfRadarScope({
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
    () => createView({ cx: size.width / 2, cy: size.height / 2, radiusPx, rangeNm: settings.rangeNm, rotation, offset }),
    [size.width, size.height, radiusPx, settings.rangeNm, rotation, offset],
  );

  // Projection centre: own ship, or (0,0) if only relative positions exist yet.
  const own = useMemo(() => (reference ? [reference.lon, reference.lat] : [0, 0]), [reference]);
  const aeqd = useMemo(() => createAeqd(own), [own]);

  // Turf work happens here, once per data / own-ship update - not per frame or per pan.
  const { shapes, local, alerts } = useMemo(() => {
    const shapeMap = new Map();
    const localMap = new Map();
    const toLocal = (c) => aeqd.toLocal(c);
    for (const o of objects) {
      const s = buildShape(o, own, { leaderMinutes: settings.leaderMinutes, bearingLength: settings.rangeNm * 3 });
      if (!s) continue;
      shapeMap.set(o.id, s);
      if (s.type === 'point') {
        localMap.set(o.id, {
          at: toLocal(s.coord),
          trail: s.trail.map(toLocal),
          leader: s.leader ? toLocal(s.leader) : null,
        });
      } else if (s.type === 'line') {
        localMap.set(o.id, { coords: s.coords.map(toLocal) });
      } else {
        localMap.set(o.id, { ring: s.ring.map(toLocal), labelAt: toLocal(s.labelAt) });
      }
    }
    return { shapes: shapeMap, local: localMap, alerts: zoneAlerts(objects, shapeMap) };
  }, [objects, own, aeqd, settings.leaderMinutes, settings.rangeNm]);

  const alertedTracks = useMemo(() => new Set(alerts.map((a) => a.trackId)), [alerts]);

  const sorted = useMemo(() => {
    const rank = (o) => (AREA_KINDS.has(o.kind) ? 0 : LINE_KINDS.has(o.kind) ? 1 : 2);
    return objects.filter((o) => local.has(o.id)).sort((a, b) => rank(a) - rank(b));
  }, [objects, local]);

  const ready = size.width > 0 && size.height > 0;

  // --------------------------------------------------------------- interaction (same as RadarScope)
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
    drag.current = { start: pointer(e), offset, view, moved: false };
  };
  const onMouseUp = () => {
    if (drag.current && !drag.current.moved) onSelect(null);
    drag.current = null;
  };
  const select = (id) => (e) => {
    e.stopPropagation();
    onSelect(id);
  };

  // In this projection local (x, y) is exact range/bearing from own ship.
  const cursorRB = cursor ? rangeBearingOf(cursor) : null;
  const cursorGeo = cursor && reference ? aeqd.toLonLat(cursor) : null;
  const ownshipAge = ownship ? (now - ownship.receivedAt) / 1000 : null;
  const P = (p) => view.project(p);

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
          onWheel={(e) => onRangeStep(e.deltaY > 0 ? 1 : -1)}
        >
          <defs>
            <clipPath id="turf-scope-clip">
              <circle cx={view.cx} cy={view.cy} r={radiusPx} />
            </clipPath>
            <radialGradient id="turf-scope-bg">
              <stop offset="0%" stopColor="#0b2230" />
              <stop offset="100%" stopColor="#050d14" />
            </radialGradient>
          </defs>

          <circle cx={view.cx} cy={view.cy} r={radiusPx} fill="url(#turf-scope-bg)" className="scope-face" />

          <g clipPath="url(#turf-scope-clip)">
            <RangeRings view={view} />
            {settings.showSweep && <Sweep view={view} />}

            {sorted.map((o) => (
              <TurfShape
                key={o.id}
                obj={o}
                shape={local.get(o.id)}
                project={P}
                settings={settings}
                selected={o.id === selectedId}
                alerted={alertedTracks.has(o.id)}
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
        </svg>
      )}

      <div className="scope-overlay top-left">
        <div>
          RANGE <b>{settings.rangeNm} NM</b> · RINGS {ringStep(settings.rangeNm)} NM
        </div>
        <div>{settings.orientation === 'HEAD_UP' ? 'HEAD UP' : 'NORTH UP'}</div>
        <div className="engine-tag">TURF.JS · GEODESIC</div>
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

      <div className="scope-overlay bottom-right alerts">
        <div className={alerts.length ? 'alerts-title active' : 'alerts-title'}>ZONE ALERTS ({alerts.length})</div>
        {alerts.slice(0, 8).map((a) => (
          <div key={`${a.trackId}-${a.zoneId}`} className="alert-row" style={{ color: identityColor(a.identity) }}>
            {a.trackLabel} ▸ {a.zoneLabel}
          </div>
        ))}
        {alerts.length > 8 && <div>+{alerts.length - 8} more</div>}
      </div>

      {cursorRB && (
        <div className="scope-overlay bottom-left">
          <div>
            CURSOR {formatBearing(cursorRB.bearing)} / {formatRange(cursorRB.range)}
          </div>
          {cursorGeo && (
            <div>
              {formatLat(cursorGeo[1])} {formatLon(cursorGeo[0])}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Draws one object from its Turf-built shape (already in local NM). */
function TurfShape({ obj, shape, project, settings, selected, alerted, onSelect, now }) {
  const color = colorOf(obj);
  const stale = obj.ttlSec !== 0 && now - obj.receivedAt > 15_000;
  const common = {
    stroke: color,
    strokeWidth: obj.style?.width ?? (selected ? 2.5 : 1.5),
    strokeDasharray: obj.style?.dashed ? '6 4' : undefined,
    fill: obj.style?.fill ?? 'none',
    fillOpacity: obj.style?.fill ? (obj.style.fillOpacity ?? 0.15) : undefined,
    opacity: stale ? 0.45 : 1,
  };

  if (obj.kind === 'TRACK' || obj.kind === 'POINT') {
    const p = project(shape.at);
    const idColor = obj.style?.color ?? identityColor(obj.identity);
    const air = String(obj.properties?.domain ?? '').toUpperCase() === 'AIR';
    return (
      <g className="obj" onMouseDown={onSelect} opacity={stale ? 0.45 : 1}>
        {obj.kind === 'TRACK' &&
          settings.showTrails &&
          shape.trail.map((t, i) => {
            const tp = project(t);
            return <circle key={i} cx={tp.x} cy={tp.y} r={1.4} fill={idColor} opacity={0.25 + (0.6 * i) / shape.trail.length} />;
          })}
        {settings.showLeaders && shape.leader && (() => {
          const e = project(shape.leader);
          return <line x1={p.x} y1={p.y} x2={e.x} y2={e.y} stroke={idColor} strokeWidth={1.3} />;
        })()}
        {alerted && <circle cx={p.x} cy={p.y} r={SYMBOL_SIZE + 7} className="zone-alert-ring" />}
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

  if (shape.coords) {
    // LINE and BEARING
    const pts = shape.coords.map(project);
    const d = toPath(pts);
    const labelPt = obj.kind === 'BEARING' ? pts[Math.min(pts.length - 1, Math.round(pts.length * 0.28))] : pts[0];
    return (
      <g className="obj" onMouseDown={onSelect}>
        <path
          d={d}
          {...common}
          fill="none"
          strokeDasharray={obj.kind === 'BEARING' && !obj.style?.dashed ? '10 3 2 3' : common.strokeDasharray}
        />
        <path d={d} className="hit-stroke" />
        {settings.showLabels && (
          <Label x={labelPt.x + 6} y={labelPt.y - 4} color={color}>
            {obj.label}
            {obj.kind === 'BEARING' ? ` ${formatBearing(obj.geometry.bearing)}` : ''}
          </Label>
        )}
      </g>
    );
  }

  // Areas: POLYGON, CIRCLE, ELLIPSE, SECTOR
  const d = toPath(shape.ring.map(project), true);
  const at = project(shape.labelAt);
  return (
    <g className="obj" onMouseDown={onSelect}>
      <path d={d} {...common} />
      <path d={d} className="hit-stroke" />
      {settings.showLabels && (
        <Label x={at.x + 4} y={at.y - 4} color={color}>
          {obj.label}
        </Label>
      )}
    </g>
  );
}
