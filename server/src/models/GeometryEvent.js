import mongoose from 'mongoose';
import config from '../config.js';

/**
 * Append-only history of every accepted message - used for track history /
 * replay and auditing. Automatically expires after HISTORY_TTL_HOURS.
 */
const geometryEventSchema = new mongoose.Schema(
  {
    objectId: { type: String, required: true },
    action: { type: String, required: true },
    kind: String,
    source: String,
    topic: String,
    identity: String,
    timestamp: { type: Number, required: true },
    geometry: mongoose.Schema.Types.Mixed,
    properties: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, minimize: false },
);

geometryEventSchema.index({ objectId: 1, timestamp: -1 });
geometryEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: Math.max(1, Math.round(config.mongo.historyTtlHours * 3600)) },
);

export default mongoose.model('GeometryEvent', geometryEventSchema);
