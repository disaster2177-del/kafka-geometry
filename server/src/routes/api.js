import { Router } from 'express';
import { KINDS, IDENTITIES } from '../services/normalizer.js';
import { getAdapter, listAdapters } from '../kafka/adapters/index.js';
import { isMongoConnected } from '../db.js';

export default function createApiRouter({ store, pipeline, persistence, consumer }) {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      mongo: isMongoConnected() ? 'connected' : 'disconnected',
      kafka: consumer.status,
      objects: store.size,
    });
  });

  router.get('/meta', (_req, res) => {
    res.json({ kinds: KINDS, identities: IDENTITIES, adapters: listAdapters() });
  });

  router.get('/stats', (_req, res) => {
    res.json({ ...pipeline.snapshotStats(), objects: store.size, kafka: consumer.status });
  });

  router.get('/errors', (_req, res) => {
    res.json(pipeline.recentErrors);
  });

  // Current live picture. Optional filters: ?kind=TRACK&identity=HOSTILE&source=RADAR-1
  router.get('/geometries', (req, res) => {
    const { kind, identity, source } = req.query;
    res.json(store.list({ kind, identity, source }));
  });

  router.get('/geometries/:id', (req, res) => {
    const obj = store.get(req.params.id);
    if (!obj) return res.status(404).json({ error: 'Not found' });
    res.json(obj);
  });

  // Stored message history for one object: ?from=<ms>&to=<ms>&limit=500
  router.get('/geometries/:id/history', async (req, res, next) => {
    try {
      if (!isMongoConnected()) return res.status(503).json({ error: 'MongoDB not connected' });
      res.json(await persistence.history(req.params.id, req.query));
    } catch (err) {
      next(err);
    }
  });

  // Manually drop an object from the picture
  router.delete('/geometries/:id', (req, res) => {
    if (!store.remove(req.params.id)) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });

  router.delete('/geometries', (_req, res) => {
    store.clear();
    res.status(204).end();
  });

  // Inject messages over HTTP (testing / systems without Kafka).
  // Body: one message, an array, or anything the chosen adapter accepts. ?adapter=legacyPlot
  router.post('/ingest', (req, res) => {
    let adapter;
    try {
      adapter = getAdapter(req.query.adapter ?? 'canonical');
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const result = pipeline.ingest(req.body, adapter, { topic: 'http' });
    res.status(result.rejected && !result.accepted ? 400 : 202).json(result);
  });

  return router;
}
