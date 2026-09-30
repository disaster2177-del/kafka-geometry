const STATE_CLASS = {
  connected: 'ok',
  connecting: 'pending',
  disconnected: 'bad',
  error: 'bad',
  disabled: 'pending',
  demo: 'ok',
};

export default function StatusBar({ connection, status, objectCount, now }) {
  const kafka = status?.kafka;
  const stats = status?.stats;
  const lastMsgAge = stats?.lastMessageAt ? Math.round((now - stats.lastMessageAt) / 1000) : null;

  return (
    <header className="statusbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="16" cy="16" r="7" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
          <path d="M16 16 L26 6" stroke="currentColor" strokeWidth="2" />
        </svg>
        NAVAL RADAR GEOMETRY
      </div>

      <div className="status-items">
        {kafka?.state === 'demo' ? (
          <span className="demo-note">Demo: the simulated Kafka feed runs in your browser</span>
        ) : (
          <span className={`pill ${STATE_CLASS[connection] ?? 'bad'}`}>SERVER {connection.toUpperCase()}</span>
        )}
        <span
          className={`pill ${STATE_CLASS[kafka?.state] ?? 'pending'}`}
          title={kafka?.error ? `Error: ${kafka.error}` : kafka?.brokers?.join(', ')}
        >
          {kafka?.state === 'demo' ? 'KAFKA SIMULATED' : `KAFKA ${(kafka?.state ?? 'unknown').toUpperCase()}`}
        </span>
        <span className="stat">
          OBJECTS <b>{objectCount}</b>
        </span>
        <span className="stat">
          MSG/S <b>{stats?.ratePerSec ?? 0}</b>
        </span>
        <span className="stat">
          RX <b>{stats?.received ?? 0}</b>
        </span>
        <span className={`stat ${stats?.rejected ? 'warn' : ''}`}>
          REJECTED <b>{stats?.rejected ?? 0}</b>
        </span>
        <span className="stat">
          LAST MSG <b>{lastMsgAge === null ? '—' : `${lastMsgAge}s`}</b>
        </span>
        <span className="stat mono">{new Date(now).toISOString().slice(11, 19)}Z</span>
      </div>
    </header>
  );
}
