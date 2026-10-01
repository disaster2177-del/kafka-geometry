import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RadarScope from './components/RadarScope.jsx';
import ScopeControls, { RANGE_STEPS } from './components/ScopeControls.jsx';
import ObjectList from './components/ObjectList.jsx';
import DetailsPanel from './components/DetailsPanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import ErrorLog from './components/ErrorLog.jsx';
import useTacticalPicture from './hooks/useTacticalPicture.js';
import useNow from './hooks/useNow.js';

// Loaded on first use so the classic scope doesn't pay for Turf.js.
const TurfRadarScope = lazy(() => import('./components/TurfRadarScope.jsx'));

const DEFAULT_SETTINGS = {
  rangeNm: 24,
  orientation: 'NORTH_UP',
  showSweep: true,
  showLabels: true,
  showTrails: true,
  showLeaders: true,
  leaderMinutes: 6,
  engine: 'classic', // 'classic' (RadarScope) | 'turf' (TurfRadarScope)
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('scopeSettings') ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const ORIGIN = { x: 0, y: 0 };

export default function App() {
  const { objects, connection, status, removeObject } = useTacticalPicture();
  const now = useNow(1000);
  const [settings, setSettings] = useState(loadSettings);
  const [filters, setFilters] = useState({
    hiddenKinds: new Set(),
    hiddenIdentities: new Set(),
    hiddenSources: new Set(),
  });
  const [offset, setOffset] = useState(ORIGIN);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('list');
  const fallbackRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('scopeSettings', JSON.stringify(settings));
    } catch {
      /* storage unavailable */
    }
  }, [settings]);

  const all = useMemo(() => Object.values(objects), [objects]);

  // Most recently updated OWNSHIP object is the scope centre.
  const ownship = useMemo(
    () =>
      all.filter((o) => o.kind === 'OWNSHIP').sort((a, b) => b.timestamp - a.timestamp)[0] ?? null,
    [all],
  );

  // Without own ship data, anchor the picture on the first absolute position we see.
  const reference = useMemo(() => {
    if (ownship) return ownship.geometry.position;
    if (!fallbackRef.current) {
      for (const o of all) {
        const g = o.geometry;
        const p = g.position ?? g.center ?? g.origin ?? g.points?.[0];
        if (p && p.lat !== undefined) {
          fallbackRef.current = p;
          break;
        }
      }
    }
    return fallbackRef.current;
  }, [ownship, all]);

  const counts = useMemo(() => {
    const kind = {};
    const identity = {};
    const sources = {};
    for (const o of all) {
      kind[o.kind] = (kind[o.kind] ?? 0) + 1;
      identity[o.identity] = (identity[o.identity] ?? 0) + 1;
      sources[o.source] = (sources[o.source] ?? 0) + 1;
    }
    return { kind, identity, sources: Object.entries(sources).sort() };
  }, [all]);

  const visible = useMemo(
    () =>
      all.filter(
        (o) =>
          o.kind !== 'OWNSHIP' &&
          !filters.hiddenKinds.has(o.kind) &&
          !filters.hiddenIdentities.has(o.identity) &&
          !filters.hiddenSources.has(o.source),
      ),
    [all, filters],
  );

  const selected = selectedId ? objects[selectedId] ?? null : null;

  const select = useCallback((id) => {
    setSelectedId(id);
    if (id) setTab('details');
  }, []);

  const stepRange = useCallback(
    (dir) =>
      setSettings((s) => {
        const i = RANGE_STEPS.indexOf(s.rangeNm);
        const next = RANGE_STEPS[Math.min(RANGE_STEPS.length - 1, Math.max(0, (i < 0 ? 5 : i) + dir))];
        return next === s.rangeNm ? s : { ...s, rangeNm: next };
      }),
    [],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'c' || e.key === 'C') setOffset(ORIGIN);
      else if (e.key === 'h' || e.key === 'H')
        setSettings((s) => ({ ...s, orientation: s.orientation === 'HEAD_UP' ? 'NORTH_UP' : 'HEAD_UP' }));
      else if (e.key === 't' || e.key === 'T')
        setSettings((s) => ({ ...s, engine: s.engine === 'turf' ? 'classic' : 'turf' }));
      else if (e.key === '+' || e.key === '=') stepRange(-1);
      else if (e.key === '-') stepRange(1);
      else if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepRange]);

  const showOwnship = !filters.hiddenKinds.has('OWNSHIP');

  // Both scope engines take the same props.
  const scopeProps = {
    objects: visible,
    ownship,
    showOwnship,
    reference,
    settings,
    offset,
    onOffsetChange: setOffset,
    onRangeStep: stepRange,
    selectedId,
    onSelect: select,
    now,
  };

  return (
    <div className="app">
      <StatusBar connection={connection} status={status} objectCount={all.length} now={now} />
      <main>
        <aside className="left">
          <ScopeControls
            settings={settings}
            setSettings={setSettings}
            filters={filters}
            setFilters={setFilters}
            counts={counts}
            onRecenter={() => setOffset(ORIGIN)}
          />
        </aside>

        <section className="center">
          {settings.engine === 'turf' ? (
            <Suspense fallback={<div className="scope-loading">Loading Turf.js engine…</div>}>
              <TurfRadarScope {...scopeProps} />
            </Suspense>
          ) : (
            <RadarScope {...scopeProps} />
          )}
        </section>

        <aside className="right">
          <nav className="tabs">
            <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
              Objects ({visible.length})
            </button>
            <button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>
              Details
            </button>
            <button className={tab === 'errors' ? 'active' : ''} onClick={() => setTab('errors')}>
              Rejected ({status?.stats?.rejected ?? 0})
            </button>
          </nav>
          {tab === 'list' && (
            <ObjectList objects={visible} reference={reference} selectedId={selectedId} onSelect={select} now={now} />
          )}
          {tab === 'details' && (
            <DetailsPanel
              obj={selected}
              reference={reference}
              now={now}
              onCenter={(local) => setOffset(local)}
              onRemove={(id) => {
                removeObject(id);
                setSelectedId(null);
              }}
            />
          )}
          {tab === 'errors' && <ErrorLog />}
        </aside>
      </main>
    </div>
  );
}
