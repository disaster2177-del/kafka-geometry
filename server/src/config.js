import 'dotenv/config';

const bool = (v, def = false) => (v === undefined || v === '' ? def : /^(1|true|yes)$/i.test(v));
const num = (v, def) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v));
const list = (v, def = []) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : def);

/**
 * KAFKA_TOPICS entries look like "topic" or "topic:adapterName".
 */
function parseTopics(value) {
  const defaults = [
    'radar.geometry',
    'radar.tracks',
    'radar.ownship',
    'radar.legacy-plots:legacyPlot',
    'radar.nmea:nmea0183',
    'ais.nmea:nmea0183',
    'c2.zones',
  ];
  return list(value, defaults).map((entry) => {
    const [topic, adapter = 'canonical'] = entry.split(':').map((s) => s.trim());
    return { topic, adapter };
  });
}

const config = {
  port: num(process.env.PORT, 4000),
  corsOrigin: list(process.env.CORS_ORIGIN, ['http://localhost:5173']),

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/naval_geometry',
    persistHistory: bool(process.env.PERSIST_HISTORY, true),
    historyTtlHours: num(process.env.HISTORY_TTL_HOURS, 24),
  },

  kafka: {
    enabled: bool(process.env.KAFKA_ENABLED, true),
    brokers: list(process.env.KAFKA_BROKERS, ['localhost:9092']),
    clientId: process.env.KAFKA_CLIENT_ID || 'naval-geometry-server',
    groupId: process.env.KAFKA_GROUP_ID || 'naval-geometry-ui',
    topics: parseTopics(process.env.KAFKA_TOPICS),
    fromBeginning: bool(process.env.KAFKA_FROM_BEGINNING, false),
    ssl: bool(process.env.KAFKA_SSL, false),
    sasl: process.env.KAFKA_SASL_MECHANISM
      ? {
          mechanism: process.env.KAFKA_SASL_MECHANISM,
          username: process.env.KAFKA_SASL_USERNAME,
          password: process.env.KAFKA_SASL_PASSWORD,
        }
      : undefined,
  },

  picture: {
    defaultTtlSec: num(process.env.DEFAULT_TTL_SEC, 120),
    trackHistoryLength: num(process.env.TRACK_HISTORY_LENGTH, 30),
    broadcastIntervalMs: num(process.env.BROADCAST_INTERVAL_MS, 200),
  },
};

export default config;
