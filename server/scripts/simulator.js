#!/usr/bin/env node
/**
 * Naval scenario simulator - publishes geometry messages to Kafka so the UI can
 * be tested without the real sensors.
 *
 *   node scripts/simulator.js                  # publish to Kafka (KAFKA_BROKERS)
 *   node scripts/simulator.js --http           # POST to http://localhost:4000/api/ingest instead
 *   node scripts/simulator.js --rate 2         # updates per second (default 1)
 *
 * Topics used (all overridable with env vars):
 *   radar.nmea           NMEA 0183 text: own ship ($GPRMC, $HEHDT) + ARPA targets ($RATTM)
 *   ais.nmea             NMEA 0183 AIS: !AIVDM messages 1 (position) and 24 (vessel name)
 *   c2.zones             GeoJSON FeatureCollection: exclusion zone, planned route, anchorage
 *   radar.tracks         canonical JSON TRACK (combat system tracks, absolute lat/lon)
 *   radar.legacy-plots   flat legacy radar format (legacyPlot adapter, range/bearing)
 *   radar.geometry       canonical JSON: ESM bearings, coverage sectors, WEZ/threat rings, AOU, datum
 */
import 'dotenv/config';
import { Kafka, Partitioners, logLevel } from 'kafkajs';
import { createScenario } from './lib/scenario.js';

const args = process.argv.slice(2);
const argValue = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const USE_HTTP = args.includes('--http');
const HTTP_URL = argValue('--url', process.env.INGEST_URL || 'http://localhost:4000/api/ingest');
const RATE = Number(argValue('--rate', 1));

const scenario = createScenario({
  rate: RATE,
  topics: Object.fromEntries(
    Object.entries({
      nmea: process.env.SIM_TOPIC_NMEA,
      ais: process.env.SIM_TOPIC_AIS,
      zones: process.env.SIM_TOPIC_ZONES,
      tracks: process.env.SIM_TOPIC_TRACKS,
      legacy: process.env.SIM_TOPIC_LEGACY,
      geometry: process.env.SIM_TOPIC_GEOMETRY,
    }).filter(([, v]) => v),
  ),
});
const TOPICS = scenario.topics;

// ---------------------------------------------------------------- transport
async function createTransport() {
  if (USE_HTTP) {
    console.log(`Simulator -> HTTP ${HTTP_URL}`);
    return {
      async send(topic, messages) {
        const text = topic === TOPICS.nmea || topic === TOPICS.ais;
        const adapter = topic === TOPICS.legacy ? '?adapter=legacyPlot' : text ? '?adapter=nmea0183' : '';
        const res = await fetch(HTTP_URL + adapter, {
          method: 'POST',
          headers: { 'content-type': text ? 'text/plain' : 'application/json' },
          body: text ? messages.join('\n') : JSON.stringify(messages),
        });
        if (!res.ok) console.error(`HTTP ${res.status}:`, await res.text());
      },
      async close() {},
    };
  }

  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({ clientId: 'naval-geometry-simulator', brokers, logLevel: logLevel.WARN });
  const admin = kafka.admin();
  await admin.connect();
  // Topics may already exist (or be auto-created by the consumer) - that's fine.
  await admin
    .createTopics({ topics: Object.values(TOPICS).map((topic) => ({ topic, numPartitions: 1 })) })
    .catch(() => {});
  await admin.disconnect();

  const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
  await producer.connect();
  console.log(`Simulator -> Kafka ${brokers.join(',')} topics ${Object.values(TOPICS).join(', ')}`);
  return {
    // Keyed by object id so updates for one object stay ordered within a partition.
    send: (topic, messages) =>
      producer.send({
        topic,
        messages: messages.map((m) =>
          typeof m === 'string'
            ? { key: null, value: m } // raw NMEA sentence
            : { key: String(m.id ?? m.trackNo ?? 'batch'), value: JSON.stringify(m) },
        ),
      }),
    close: () => producer.disconnect(),
  };
}


// ---------------------------------------------------------------- main loop
async function main() {
  const transport = await createTransport();

  const step = async () => {
    const batches = scenario.step();
    await Promise.all(batches.map(({ topic, messages }) => transport.send(topic, messages)));
    if (scenario.tick % Math.round(10 * RATE) === 0) console.log(`tick ${scenario.tick}: ${scenario.trackCount} tracks`);
  };

  const timer = setInterval(() => step().catch((err) => console.error('send failed:', err.message)), 1000 / RATE);
  await step();

  const stop = async () => {
    clearInterval(timer);
    await transport.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
