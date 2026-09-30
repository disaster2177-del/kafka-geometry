import { Server } from 'socket.io';
import config from './config.js';
import logger from './logger.js';

/**
 * Socket.IO protocol (server -> client):
 *   "snapshot"        full live picture, sent on connect / on "snapshot:request"
 *   "geometry:batch"  { upserts: object[], deletes: string[] } every BROADCAST_INTERVAL_MS
 *   "status"          { kafka, stats, objects } every second
 */
export function createSocketServer(httpServer, { store, pipeline, consumer }) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigin },
  });

  const status = () => ({
    kafka: consumer.status,
    stats: pipeline.snapshotStats(),
    objects: store.size,
    serverTime: Date.now(),
  });

  io.on('connection', (socket) => {
    logger.info(`UI client connected (${socket.id}), ${io.engine.clientsCount} total`);
    socket.emit('snapshot', store.list());
    socket.emit('status', status());
    socket.on('snapshot:request', () => socket.emit('snapshot', store.list()));
    socket.on('disconnect', () => logger.info(`UI client disconnected (${socket.id})`));
  });

  store.on('flush', (batch) => io.emit('geometry:batch', batch));
  consumer.on('status', () => io.emit('status', status()));

  const flushTimer = setInterval(() => store.flush(), config.picture.broadcastIntervalMs);
  const sweepTimer = setInterval(() => store.sweep(), 1000);
  const statusTimer = setInterval(() => io.emit('status', status()), 1000);

  return {
    io,
    close() {
      clearInterval(flushTimer);
      clearInterval(sweepTimer);
      clearInterval(statusTimer);
      io.close();
    },
  };
}
