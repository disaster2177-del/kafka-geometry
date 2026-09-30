import { useEffect, useReducer, useState } from 'react';
import { deleteObject, subscribe } from '../lib/api.js';

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
 * Subscribes to the live feed (Socket.IO, or the demo engine) and keeps the tactical picture.
 */
export default function useTacticalPicture() {
  const [state, dispatch] = useReducer(reducer, { objects: {}, version: 0 });
  const [connection, setConnection] = useState('connecting');
  const [status, setStatus] = useState(null);

  useEffect(() => {
    return subscribe({
      onSnapshot: (list) => dispatch({ type: 'snapshot', list }),
      onBatch: ({ upserts, deletes }) => dispatch({ type: 'batch', upserts, deletes }),
      onStatus: setStatus,
      onConnection: setConnection,
    });
  }, []);

  const removeObject = async (id) => {
    if (await deleteObject(id)) dispatch({ type: 'remove', id });
  };

  return { objects: state.objects, version: state.version, connection, status, removeObject };
}
