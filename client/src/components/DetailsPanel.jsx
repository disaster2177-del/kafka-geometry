import { useEffect, useState } from 'react';
import { formatBearing, formatLat, formatLon, formatRange, rangeBearingOf, toLocal } from '../lib/geo.js';
import { colorOf } from '../lib/symbology.js';
import { getHistory } from '../lib/api.js';
import { anchorOf } from './ObjectList.jsx';

function formatPosition(p) {
  if (!p) return '—';
  if (p.lat !== undefined) return `${formatLat(p.lat)} ${formatLon(p.lon)}`;
  return `${formatBearing(p.bearing)} / ${formatRange(p.range)} (rel. own ship)`;
}

function formatValue(key, v) {
  if (v && typeof v === 'object') {
    if (v.lat !== undefined || v.range !== undefined) return formatPosition(v);
    if (Array.isArray(v)) return v.map((p) => formatPosition(p)).join('\n');
    return JSON.stringify(v);
  }
  if (typeof v === 'number') {
    if (/bearing|orientation|course|heading/i.test(key)) return formatBearing(v);
    if (/radius|range|length|semi/i.test(key)) return formatRange(v);
    return String(Number(v.toFixed(4)));
  }
  return v === null || v === undefined ? '—' : String(v);
}

function KeyValues({ entries }) {
  return (
    <dl className="kv">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{formatValue(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function DetailsPanel({ obj, reference, now, onCenter, onRemove }) {
  const [history, setHistory] = useState(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    setHistory(null);
  }, [obj?.id]);

  if (!obj) return <div className="panel details empty">Select an object on the scope or in the list.</div>;

  const l = toLocal(anchorOf(obj), reference);
  const rb = l ? rangeBearingOf(l) : null;

  const loadHistory = async () => {
    setHistory({ loading: true });
    try {
      setHistory({ items: await getHistory(obj.id, 50) });
    } catch (err) {
      setHistory({ error: err.message });
    }
  };

  return (
    <div className="panel details">
      <header>
        <span className="swatch big" style={{ background: colorOf(obj) }} />
        <div>
          <h2>{obj.label}</h2>
          <div className="sub">
            {obj.kind} · {obj.identity} · {obj.source}
          </div>
        </div>
      </header>

      <div className="btn-row">
        {l && <button onClick={() => onCenter(l)}>Centre scope</button>}
        {obj.kind !== 'OWNSHIP' && <button onClick={() => onRemove(obj.id)}>Drop from picture</button>}
        <button onClick={loadHistory}>History</button>
        <button onClick={() => setShowRaw((v) => !v)}>{showRaw ? 'Hide' : 'Raw'} JSON</button>
      </div>

      <h3>General</h3>
      <KeyValues
        entries={[
          ['id', obj.id],
          ['topic', obj.topic],
          ['from own ship', rb && obj.kind !== 'OWNSHIP' ? `${formatBearing(rb.bearing)} / ${formatRange(rb.range)}` : '—'],
          ['sensor time', new Date(obj.timestamp).toISOString().replace('T', ' ').slice(0, 19) + 'Z'],
          ['age', `${Math.max(0, Math.round((now - obj.receivedAt) / 1000))} s`],
          ['ttl', obj.ttlSec == null ? 'default' : obj.ttlSec === 0 ? 'never expires' : `${obj.ttlSec} s`],
          ...(obj.trail ? [['trail points', obj.trail.length]] : []),
        ]}
      />

      <h3>Geometry</h3>
      <KeyValues entries={Object.entries(obj.geometry)} />

      {Object.keys(obj.properties ?? {}).length > 0 && (
        <>
          <h3>Properties</h3>
          <KeyValues entries={Object.entries(obj.properties)} />
        </>
      )}

      {history && (
        <>
          <h3>History (latest 50)</h3>
          {history.loading && <div className="empty">Loading…</div>}
          {history.error && <div className="warn">{history.error}</div>}
          {history.items && (
            <div className="table-wrap small">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Position</th>
                  </tr>
                </thead>
                <tbody>
                  {history.items.map((h, i) => (
                    <tr key={i}>
                      <td className="mono">{new Date(h.timestamp).toISOString().slice(11, 19)}</td>
                      <td>{h.action}</td>
                      <td className="mono">
                        {formatPosition(h.geometry?.position ?? h.geometry?.center ?? h.geometry?.origin)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showRaw && <pre className="raw">{JSON.stringify(obj, null, 2)}</pre>}
    </div>
  );
}
