/**
 * Data access for the UI. Talks to the Express API / Socket.IO server, or to
 * the in-browser demo engine when built with VITE_DEMO=true.
 */
export const DEMO = import.meta.env.VITE_DEMO === 'true';

let demoEngine = null;
async function demo() {
  if (!demoEngine) {
    const { createDemoEngine } = await import('../demo/demoEngine.js');
    demoEngine = createDemoEngine();
  }
  return demoEngine;
}

/**
 * Subscribe to the live picture. Handlers: onSnapshot(list), onBatch({upserts, deletes}),
 * onStatus(status), onConnection('connecting'|'connected'|'disconnected'|'error').
 * Returns an unsubscribe function.
 */
export function subscribe({ onSnapshot, onBatch, onStatus, onConnection }) {
  let cleanup = () => {};
  let cancelled = false;

  if (DEMO) {
    demo().then((engine) => {
      if (cancelled) return;
      const offs = [engine.on('snapshot', onSnapshot), engine.on('batch', onBatch), engine.on('status', onStatus)];
      engine.start();
      onConnection('connected');
      cleanup = () => {
        offs.forEach((off) => off());
        engine.stop();
      };
    });
  } else {
    import('socket.io-client').then(({ io }) => {
      if (cancelled) return;
      const socket = io(import.meta.env.VITE_SOCKET_URL || undefined, { transports: ['websocket', 'polling'] });
      socket.on('connect', () => onConnection('connected'));
      socket.on('disconnect', () => onConnection('disconnected'));
      socket.on('connect_error', () => onConnection('error'));
      socket.on('snapshot', onSnapshot);
      socket.on('geometry:batch', onBatch);
      socket.on('status', onStatus);
      cleanup = () => socket.disconnect();
    });
  }

  return () => {
    cancelled = true;
    cleanup();
  };
}

export async function getErrors() {
  if (DEMO) return (await demo()).errors();
  const res = await fetch('/api/errors');
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export async function getHistory(id, limit = 50) {
  if (DEMO) return (await demo()).history(id).slice(0, limit);
  const res = await fetch(`/api/geometries/${encodeURIComponent(id)}/history?limit=${limit}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

/** Drop an object from the live picture. Resolves true if it is gone. */
export async function deleteObject(id) {
  if (DEMO) {
    (await demo()).remove(id);
    return true;
  }
  const res = await fetch(`/api/geometries/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.ok || res.status === 404;
}
