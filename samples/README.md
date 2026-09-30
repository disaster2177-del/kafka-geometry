# Sample data

These are sample messages in the standard formats the app accepts, all for one scenario: own
ship at 36°30'N 015°12'E, heading 045°.

| file                       | format | Kafka topic | adapter |
|----------------------------|--------|-------------|---------|
| `nmea/radar-arpa.nmea`     | NMEA 0183 (IEC 61162-1): `$HEHDT` gyro heading, `$GPRMC` / `$GPGGA` / `$GPVTG` GPS, `$RATTM` / `$RATLL` ARPA radar targets (target 06 is `L` = lost, so it is deleted) | `radar.nmea` | `nmea0183` |
| `nmea/ais.nmea`            | AIS as NMEA `!AIVDM` (ITU-R M.1371): message 24A (vessel name) and message 1 (class A position report) | `ais.nmea` | `nmea0183` |
| `geojson/zones.geojson`    | GeoJSON (RFC 7946) `FeatureCollection`: exclusion zone, planned route, anchorage | `c2.zones` | `canonical` |
| `canonical/geometry.jsonl` | the app's canonical JSON, one message per line, with one example of every geometry kind | `radar.geometry` | `canonical` |
| `legacy/plots.jsonl`       | an example of a custom flat format that the `legacyPlot` adapter maps | `radar.legacy-plots` | `legacyPlot` |

The NMEA files have one sentence per line, and each line is sent as its own Kafka message.
All checksums are valid.

## Testing by hand

[`manual/`](manual/README.md) has one-line messages for each topic that you can copy and paste into
`kafka-console-producer`, with step-by-step instructions.

## Publish the samples

```bash
cd server
npm run samples                    # once, to Kafka
npm run samples -- --loop 5        # every 5 s, so tracks don't expire (DEFAULT_TTL_SEC)
npm run samples -- --http          # without Kafka: POST to /api/ingest
```

To publish by hand with the Kafka console producer:

```bash
docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server localhost:9092 --topic radar.nmea < samples/nmea/radar-arpa.nmea
```

To send a file straight to the HTTP endpoint:

```bash
curl -X POST 'localhost:4000/api/ingest?adapter=nmea0183' -H 'content-type: text/plain' --data-binary @samples/nmea/ais.nmea
curl -X POST 'localhost:4000/api/ingest' -H 'content-type: application/json' --data-binary @samples/geojson/zones.geojson
```

To regenerate the files after changing the scenario, run `npm run generate-samples`.
