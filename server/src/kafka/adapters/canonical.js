/**
 * Default adapter: the payload already follows the canonical schema
 * (see services/normalizer.js and README). Also accepts:
 *  - an array of messages                 [ {...}, {...} ]
 *  - a batch envelope                     { items: [ ... ] } / { messages: [ ... ] }
 *  - a GeoJSON FeatureCollection          { type: "FeatureCollection", features: [ ... ] }
 */
export default function canonical(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    if (value.type === 'FeatureCollection' && Array.isArray(value.features)) return value.features;
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.messages)) return value.messages;
  }
  return [value];
}
