#!/usr/bin/env node
/**
 * Publishes the files in /samples to their Kafka topics.
 *
 *   node scripts/publish-samples.js            # once, to Kafka (KAFKA_BROKERS)
 *   node scripts/publish-samples.js --loop 5   # re-publish every 5 s (keeps tracks from expiring)
 *   node scripts/publish-samples.js --http     # POST to /api/ingest instead of Kafka
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kafka, Partitioners, logLevel } from 'kafkajs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples');
const args = process.argv.slice(2);
const USE_HTTP = args.includes('--http');
const loopIdx = args.indexOf('--loop');
const LOOP_SEC = loopIdx >= 0 ? Number(args[loopIdx + 1] || 5) : 0;
const HTTP_URL = process.env.INGEST_URL || 'http://localhost:4000/api/ingest';

// file -> topic, how the file is split into Kafka messages, adapter for HTTP mode
const SAMPLES = [
  { file: 'nmea/radar-arpa.nmea', topic: 'radar.nmea', split: 'lines', text: true, adapter: 'nmea0183' },
  { file: 'nmea/ais.nmea', topic: 'ais.nmea', split: 'lines', text: true, adapter: 'nmea0183' },
  { file: 'geojson/zones.geojson', topic: 'c2.zones', split: 'file' },
  { file: 'canonical/geometry.jsonl', topic: 'radar.geometry', split: 'lines' },
  { file: 'legacy/plots.jsonl', topic: 'radar.legacy-plots', split: 'lines', adapter: 'legacyPlot' },
];

function load({ file, split }) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  return split === 'file' ? [content] : content.split(/\r?\n/).filter((l) => l.trim());
}

async function main() {
  let send;
  let close = async () => {};

  if (USE_HTTP) {
    send = async (s, messages) => {
      const res = await fetch(`${HTTP_URL}${s.adapter ? `?adapter=${s.adapter}` : ''}`, {
        method: 'POST',
        headers: { 'content-type': s.text ? 'text/plain' : 'application/json' },
        body: s.text ? messages.join('\n') : `[${messages.join(',')}]`,
      });
      console.log(`${s.file} -> HTTP ${res.status} ${await res.text()}`);
    };
  } else {
    const kafka = new Kafka({
      clientId: 'naval-geometry-samples',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      logLevel: logLevel.WARN,
    });
    const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner, allowAutoTopicCreation: true });
    await producer.connect();
    send = async (s, messages) => {
      await producer.send({ topic: s.topic, messages: messages.map((value) => ({ value })) });
      console.log(`${s.file} -> ${s.topic} (${messages.length} messages)`);
    };
    close = () => producer.disconnect();
  }

  const publishAll = async () => {
    for (const s of SAMPLES) await send(s, load(s));
  };

  await publishAll();
  if (!LOOP_SEC) return close();
  setInterval(() => publishAll().catch((e) => console.error(e.message)), LOOP_SEC * 1000);
  process.on('SIGINT', async () => {
    await close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
