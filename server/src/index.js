import http from 'node:http';
import config from './config.js';
import logger from './logger.js';
import { connectMongo } from './db.js';
import { createApp } from './app.js';
import { createSocketServer } from './socket.js';
import { GeometryStore } from './services/geometryStore.js';
import { Persistence } from './services/persistence.js';
import { IngestPipeline } from './services/ingest.js';
import { GeometryConsumer } from './kafka/consumer.js';

async function main() {
  const store = new GeometryStore(config.picture);
  const persistence = new Persistence(store);
  const pipeline = new IngestPipeline({ store, persistence });
  const consumer = new GeometryConsumer(pipeline);

  try {
    await connectMongo();
    const saved = await persistence.loadLivePicture();
    store.hydrate(saved);
    logger.info(`Restored ${store.size} objects from MongoDB`);
  } catch (err) {
    logger.error(`MongoDB unavailable (${err.message}) - running with in-memory picture only`);
  }

  const app = createApp({ store, pipeline, persistence, consumer });
  const server = http.createServer(app);
  const sockets = createSocketServer(server, { store, pipeline, consumer });

  server.listen(config.port, () => logger.info(`API + WebSocket listening on :${config.port}`));

  // Do not block startup on Kafka - it reconnects in the background.
  consumer.start().catch((err) => logger.error('Kafka consumer stopped:', err));

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    await consumer.stop();
    sockets.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
