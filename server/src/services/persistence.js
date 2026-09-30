import Geometry from '../models/Geometry.js';
import GeometryEvent from '../models/GeometryEvent.js';
import { isMongoConnected } from '../db.js';
import config from '../config.js';
import logger from '../logger.js';

const MAX_EVENT_BUFFER = 50_000;

/**
 * Writes the live picture (latest state) and the message history to MongoDB.
 * Writes are batched and run in the background so Kafka consumption never
 * waits on the database. If MongoDB is down the live picture keeps working.
 */
export class Persistence {
  constructor(store) {
    this.store = store;
    this.eventBuffer = [];
    this.writing = Promise.resolve();
    store.on('flush', (batch) => this.#enqueue(() => this.#writeBatch(batch)));
  }

  async loadLivePicture() {
    const docs = await Geometry.find().lean();
    return docs.map(({ _id, updatedAt, ...rest }) => ({ id: _id, ...rest }));
  }

  recordEvent(msg) {
    if (!config.mongo.persistHistory) return;
    if (this.eventBuffer.length >= MAX_EVENT_BUFFER) this.eventBuffer.shift();
    this.eventBuffer.push({
      objectId: msg.id,
      action: msg.action,
      kind: msg.kind,
      source: msg.source,
      topic: msg.topic,
      identity: msg.identity,
      timestamp: msg.timestamp,
      geometry: msg.geometry,
      properties: msg.properties,
    });
  }

  async history(objectId, { from, to, limit = 500 } = {}) {
    const query = { objectId };
    if (from || to) {
      query.timestamp = {};
      if (from) query.timestamp.$gte = Number(from);
      if (to) query.timestamp.$lte = Number(to);
    }
    return GeometryEvent.find(query, { _id: 0 })
      .sort({ timestamp: -1 })
      .limit(Math.min(Number(limit) || 500, 5000))
      .lean();
  }

  #enqueue(task) {
    this.writing = this.writing.then(task).catch((err) => logger.error('Mongo write failed:', err.message));
  }

  async #writeBatch({ upserts, deletes }) {
    if (!isMongoConnected()) return;

    const ops = [
      ...upserts.map(({ id, ...doc }) => ({
        replaceOne: { filter: { _id: id }, replacement: { _id: id, ...doc }, upsert: true },
      })),
      ...deletes.map((id) => ({ deleteOne: { filter: { _id: id } } })),
    ];
    if (ops.length) await Geometry.bulkWrite(ops, { ordered: false });

    if (this.eventBuffer.length) {
      const events = this.eventBuffer.splice(0, this.eventBuffer.length);
      await GeometryEvent.insertMany(events, { ordered: false });
    }
  }
}
