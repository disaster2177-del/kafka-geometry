import { IDENTITY_COLORS, IDENTITY_LABELS, KIND_LABELS } from '../lib/symbology.js';

export const RANGE_STEPS = [0.5, 1, 2, 3, 6, 12, 24, 48, 96, 192];

export default function ScopeControls({ settings, setSettings, filters, setFilters, counts, onRecenter }) {
  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const toggleIn = (key, value) =>
    setFilters((f) => {
      const next = new Set(f[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...f, [key]: next };
    });

  return (
    <div className="panel controls">
      <section>
        <h3>Geometry engine</h3>
        <div className="btn-row" role="group" aria-label="Geometry engine">
          <button
            className={settings.engine !== 'turf' ? 'active' : ''}
            aria-pressed={settings.engine !== 'turf'}
            onClick={() => set({ engine: 'classic' })}
            title="Flat local projection (original scope)"
          >
            Classic
          </button>
          <button
            className={settings.engine === 'turf' ? 'active' : ''}
            aria-pressed={settings.engine === 'turf'}
            onClick={() => set({ engine: 'turf' })}
            title="Turf.js: geodesic shapes, azimuthal equidistant projection, zone alerts"
          >
            Turf.js
          </button>
        </div>
        <p className="engine-hint">
          {settings.engine === 'turf'
            ? 'Geodesic shapes and exact range/bearing at any distance, plus zone alerts.'
            : 'Flat local projection. Accurate to about 100 m at 48 NM.'}
        </p>
      </section>

      <section>
        <h3>Range (NM)</h3>
        <div className="btn-row wrap">
          {RANGE_STEPS.map((r) => (
            <button key={r} className={settings.rangeNm === r ? 'active' : ''} onClick={() => set({ rangeNm: r })}>
              {r}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Orientation</h3>
        <div className="btn-row">
          <button className={settings.orientation === 'NORTH_UP' ? 'active' : ''} onClick={() => set({ orientation: 'NORTH_UP' })}>
            North up
          </button>
          <button className={settings.orientation === 'HEAD_UP' ? 'active' : ''} onClick={() => set({ orientation: 'HEAD_UP' })}>
            Head up
          </button>
          <button onClick={onRecenter} title="Re-centre on own ship (C)">
            Centre
          </button>
        </div>
      </section>

      <section>
        <h3>Display</h3>
        {[
          ['showSweep', 'Radar sweep'],
          ['showLabels', 'Labels'],
          ['showTrails', 'Track history trails'],
          ['showLeaders', 'Velocity leaders'],
        ].map(([key, label]) => (
          <label key={key} className="check">
            <input type="checkbox" checked={settings[key]} onChange={(e) => set({ [key]: e.target.checked })} />
            {label}
          </label>
        ))}
        <label className="check">
          Leader length
          <select value={settings.leaderMinutes} onChange={(e) => set({ leaderMinutes: Number(e.target.value) })}>
            {[1, 3, 6, 12, 30].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <h3>Layers</h3>
        {Object.entries(KIND_LABELS).map(([kind, label]) => (
          <label key={kind} className="check">
            <input type="checkbox" checked={!filters.hiddenKinds.has(kind)} onChange={() => toggleIn('hiddenKinds', kind)} />
            {label}
            <span className="count">{counts.kind[kind] ?? 0}</span>
          </label>
        ))}
      </section>

      <section>
        <h3>Identity</h3>
        {Object.entries(IDENTITY_LABELS).map(([id, label]) => (
          <label key={id} className="check">
            <input
              type="checkbox"
              checked={!filters.hiddenIdentities.has(id)}
              onChange={() => toggleIn('hiddenIdentities', id)}
            />
            <span className="swatch" style={{ background: IDENTITY_COLORS[id] }} />
            {label}
            <span className="count">{counts.identity[id] ?? 0}</span>
          </label>
        ))}
      </section>

      {counts.sources.length > 0 && (
        <section>
          <h3>Sources</h3>
          {counts.sources.map(([source, n]) => (
            <label key={source} className="check">
              <input
                type="checkbox"
                checked={!filters.hiddenSources.has(source)}
                onChange={() => toggleIn('hiddenSources', source)}
              />
              {source}
              <span className="count">{n}</span>
            </label>
          ))}
        </section>
      )}

      <p className="hint">Mouse wheel: range · drag: pan · click: select · C: centre · H: head/north up · T: switch engine</p>
    </div>
  );
}
