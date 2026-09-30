import { useEffect, useState } from 'react';

/** Messages rejected by the server (invalid JSON, schema errors, ...). */
export default function ErrorLog() {
  const [errors, setErrors] = useState([]);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch('/api/errors');
        if (!res.ok) throw new Error(res.statusText);
        const body = await res.json();
        if (active) {
          setErrors(body);
          setFailed(null);
        }
      } catch (err) {
        if (active) setFailed(err.message);
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="panel errors">
      {failed && <div className="warn">Could not load errors: {failed}</div>}
      {!failed && errors.length === 0 && <div className="empty">No rejected messages.</div>}
      {errors.map((e, i) => (
        <div key={i} className="error-item">
          <div className="error-head">
            <span className="mono">{new Date(e.at).toISOString().slice(11, 19)}</span>
            <span>{e.topic}</span>
            {e.offset !== undefined && <span className="mono">@{e.offset}</span>}
          </div>
          <div className="warn">{e.reason}</div>
          <pre className="raw">{e.payload}</pre>
        </div>
      ))}
    </div>
  );
}
