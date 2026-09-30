import { useMemo, useState } from 'react';
import { formatBearing, rangeBearingOf, toLocal } from '../lib/geo.js';
import { colorOf } from '../lib/symbology.js';

/** Anchor position used to compute range/bearing for any kind. */
export function anchorOf(obj) {
  const g = obj.geometry;
  return g.position ?? g.center ?? g.origin ?? g.points?.[0] ?? null;
}

export default function ObjectList({ objects, reference, selectedId, onSelect, now }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('range');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return objects
      .filter((o) => o.kind !== 'OWNSHIP')
      .filter(
        (o) =>
          !q ||
          [o.id, o.label, o.kind, o.identity, o.source, o.properties?.platform]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
      )
      .map((o) => {
        const l = toLocal(anchorOf(o), reference);
        const rb = l ? rangeBearingOf(l) : null;
        return { o, rb };
      })
      .sort((a, b) => {
        if (sortKey === 'range') return (a.rb?.range ?? Infinity) - (b.rb?.range ?? Infinity);
        if (sortKey === 'age') return b.o.receivedAt - a.o.receivedAt;
        return String(a.o[sortKey]).localeCompare(String(b.o[sortKey]));
      });
  }, [objects, reference, query, sortKey]);

  const th = (key, label) => (
    <th className={sortKey === key ? 'sorted' : ''} onClick={() => setSortKey(key)}>
      {label}
    </th>
  );

  return (
    <div className="panel list">
      <input className="search" placeholder="Filter id, label, kind, identity, source…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {th('label', 'Label')}
              {th('kind', 'Kind')}
              {th('identity', 'Ident')}
              {th('range', 'Brg / Rng')}
              <th>Crs / Spd</th>
              {th('age', 'Age')}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ o, rb }) => {
              const course = o.properties?.course;
              const speed = o.properties?.speed;
              return (
                <tr key={o.id} className={o.id === selectedId ? 'selected' : ''} onClick={() => onSelect(o.id)}>
                  <td>
                    <span className="swatch" style={{ background: colorOf(o) }} />
                    {o.label}
                  </td>
                  <td>{o.kind}</td>
                  <td>{o.identity}</td>
                  <td className="mono">{rb ? `${formatBearing(rb.bearing)} ${rb.range.toFixed(1)}` : '—'}</td>
                  <td className="mono">
                    {course !== undefined ? `${formatBearing(Number(course))} ${Number(speed ?? 0).toFixed(0)}kn` : '—'}
                  </td>
                  <td className="mono">{Math.max(0, Math.round((now - o.receivedAt) / 1000))}s</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">No objects</div>}
      </div>
    </div>
  );
}
