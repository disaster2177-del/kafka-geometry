import { useEffect, useReducer, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined; // same origin by default

function reducer(state, action) {
  switch (action.type) {
    case 'snapshot': {
      const objects = {};
      for (const o of action.list) objects[o.id] = o;
      return { objects, version: state.version + 1 };
    }
    case 'batch': {
      if (!action.upserts.length && !action.deletes.length) return state;
      const objects = { ...state.objects };
      for (const id of action.deletes) delete objects[id];
      for (const o of action.upserts) objects[o.id] = o;
      return { objects, version: state.version + 1 };
    }
    case 'remove': {
      const objects = { ...state.objects };
      delete objects[action.id];
      return { objects, version: state.version + 1 };
    }
    default:
      return state;
  }
}

/**
 * Subscribes to the server's Socket.IO feed and keeps the live tactical picture.
 */
export default function useTacticalPicture() {
  const [state, dispatch] = useReducer(reducer, { objects: {}, version: 0 });
  const [connection, setConnection] = useState('connecting');
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => setConnection('connected'));
    socket.on('disconnect', () => setConnection('disconnected'));
    socket.on('connect_error', () => setConnection('error'));
    socket.on('snapshot', (list) => dispatch({ type: 'snapshot', list }));
    socket.on('geometry:batch', ({ upserts, deletes }) => dispatch({ type: 'batch', upserts, deletes }));
    socket.on('status', setStatus);
    return () => socket.disconnect();
  }, []);

  const removeObject = async (id) => {
    const res = await fetch(`/api/geometries/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) dispatch({ type: 'remove', id });
  };

  return { objects: state.objects, version: state.version, connection, status, removeObject };
}
