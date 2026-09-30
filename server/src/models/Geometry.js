import mongoose from 'mongoose';

/**
 * Latest known state of every object in the tactical picture (one document per id).
 * Geometry is kind specific, so it is stored as a flexible sub-document.
 */
const geometrySchema = new mongoose.Schema(
  {
    _id: { type: String }, // object id
    kind: { type: String, required: true, index: true },
    source: { type: String, index: true },
    topic: String,
    identity: { type: String, index: true },
    label: String,
    timestamp: { type: Number, required: true },
    receivedAt: { type: Number, required: true },
    ttlSec: { type: Number, default: null },
    style: { type: mongoose.Schema.Types.Mixed, default: {} },
    geometry: { type: mongoose.Schema.Types.Mixed, required: true },
    properties: { type: mongoose.Schema.Types.Mixed, default: {} },
    trail: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { versionKey: false, minimize: false, timestamps: { createdAt: false, updatedAt: 'updatedAt' } },
);

geometrySchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.updatedAt;
    return ret;
  },
});

export default mongoose.model('Geometry', geometrySchema);
