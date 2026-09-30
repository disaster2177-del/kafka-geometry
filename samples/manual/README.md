# Manual Kafka test messages

These are copy-paste messages for testing the app by hand with the Kafka console producer. Each
line is one Kafka message, so paste the lines exactly as they are and don't wrap or reformat
them.

- **Relative positions:** most positions use range/bearing, so they are drawn around own ship.
- **Nothing expires:** every message has `ttlSec: 0`, so nothing disappears while you test.
- **No timestamps:** the server stamps each message on arrival, so every paste counts as newest.
  The NMEA and AIS sentences carry their own times, which the server keeps.

## Before you start

1. Start the stack without the simulator, so it doesn't overwrite what you paste:
   `docker compose up -d kafka mongo`, then `npm run dev`.
2. Open http://localhost:5173 (dev) or http://localhost:4000 (Docker).
3. Open a console producer for a topic, paste the lines, and press Ctrl+C to exit:

```bash
docker exec -it kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic <topic>
```

To send a whole file instead of pasting:

```bash
docker exec -i kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic radar.tracks < samples/manual/2-tracks.jsonl
```

If Kafka isn't running in Docker, use `bin/kafka-console-producer.sh` from your Kafka install.
You can also skip Kafka and POST the lines to the server:
`curl -X POST localhost:4000/api/ingest -H 'content-type: application/json' -d '<one line>'`.

## 1. Own ship (send this first)

Topic: `radar.ownship`. File: `1-ownship.jsonl`. The first line clears any previous own ship. After that, all range/bearing positions are drawn relative to 36°30'N 015°12'E, heading 045°.

```json
{"id":"OWNSHIP","action":"DELETE"}
{"id":"OWNSHIP","kind":"OWNSHIP","source":"NAV","identity":"FRIEND","label":"OWN SHIP","geometry":{"position":{"lat":36.5,"lon":15.2}},"properties":{"heading":45,"course":45,"speed":16}}
```

## 2. Tracks

Topic: `radar.tracks`. File: `2-tracks.jsonl`. Five identities: hostile, friend, unknown (air), neutral and suspect. Positions use range/bearing and lat/lon.

```json
{"id":"T100","kind":"TRACK","source":"RADAR-1","identity":"HOSTILE","ttlSec":0,"geometry":{"position":{"range":12,"bearing":30}},"properties":{"course":210,"speed":28,"platform":"FAC"}}
{"id":"T101","kind":"TRACK","source":"RADAR-1","identity":"FRIEND","ttlSec":0,"geometry":{"position":{"lat":36.43333,"lon":15.34365}},"properties":{"course":45,"speed":16,"platform":"FFG"}}
{"id":"T102","kind":"TRACK","source":"RADAR-1","identity":"UNKNOWN","ttlSec":0,"geometry":{"position":{"range":18,"bearing":280}},"properties":{"course":95,"speed":250,"domain":"AIR","altitude":12000}}
{"id":"T103","kind":"TRACK","source":"RADAR-1","identity":"NEUTRAL","ttlSec":0,"geometry":{"position":{"range":6,"bearing":200}},"properties":{"course":330,"speed":11,"platform":"MERCHANT"}}
{"id":"T104","kind":"TRACK","source":"RADAR-1","identity":"SUSPECT","ttlSec":0,"geometry":{"position":{"range":15,"bearing":160}},"properties":{"course":300,"speed":35,"platform":"FAST BOAT"}}
```

## 3. Move a track and delete one

Topic: `radar.tracks`. File: `3-track-updates.jsonl`. T100 moves in three steps and builds a trail. T104 is deleted.

```json
{"id":"T100","kind":"TRACK","source":"RADAR-1","identity":"HOSTILE","ttlSec":0,"geometry":{"position":{"range":11.5,"bearing":29}},"properties":{"course":210,"speed":28,"platform":"FAC"}}
{"id":"T100","kind":"TRACK","source":"RADAR-1","identity":"HOSTILE","ttlSec":0,"geometry":{"position":{"range":11,"bearing":28}},"properties":{"course":210,"speed":28,"platform":"FAC"}}
{"id":"T100","kind":"TRACK","source":"RADAR-1","identity":"HOSTILE","ttlSec":0,"geometry":{"position":{"range":10.5,"bearing":27}},"properties":{"course":210,"speed":28,"platform":"FAC"}}
{"id":"T104","action":"DELETE"}
```

## 4. All other geometry types

Topic: `radar.geometry`. File: `4-geometry.jsonl`. SAM WEZ ring, threat circle, ellipse (AOU), blind-arc sector, ESM bearing line, route, box polygon and datum point.

```json
{"id":"WEZ-SAM","kind":"CIRCLE","source":"CMS","identity":"FRIEND","label":"SAM WEZ","ttlSec":0,"geometry":{"radius":10},"style":{"color":"#4fc3f7","dashed":true}}
{"id":"THREAT-T100","kind":"CIRCLE","source":"CMS","identity":"HOSTILE","label":"T100 SSM","ttlSec":0,"geometry":{"center":{"range":12,"bearing":30},"radius":5},"style":{"fill":"#ff3b3b","fillOpacity":0.08}}
{"id":"AOU-1","kind":"ELLIPSE","source":"FUSION","identity":"UNKNOWN","label":"AOU","ttlSec":0,"geometry":{"center":{"range":18,"bearing":280},"semiMajor":3,"semiMinor":1.2,"orientation":95}}
{"id":"BLIND-ARC","kind":"SECTOR","source":"RADAR-1","identity":"FRIEND","label":"BLIND ARC","ttlSec":0,"geometry":{"startBearing":200,"endBearing":250,"innerRadius":0,"outerRadius":25},"style":{"color":"#f5a623","fill":"#f5a623","fillOpacity":0.08,"dashed":true}}
{"id":"ESM-1","kind":"BEARING","source":"ESM","identity":"HOSTILE","label":"ESM 1","ttlSec":0,"geometry":{"bearing":31},"properties":{"emitter":"I-band radar","frequencyMHz":9410}}
{"id":"ROUTE-1","kind":"LINE","source":"NAV","identity":"FRIEND","label":"ROUTE","ttlSec":0,"geometry":{"points":[{"lat":36.5,"lon":15.2},{"lat":36.61785,"lon":15.34661},{"lat":36.61401,"lon":15.58966}]},"style":{"color":"#8bc34a","dashed":true}}
{"id":"BOX-A","kind":"POLYGON","source":"C2","identity":"NEUTRAL","label":"BOX A","ttlSec":0,"geometry":{"points":[{"range":14,"bearing":320},{"range":20,"bearing":335},{"range":17,"bearing":355},{"range":11,"bearing":340}]},"style":{"color":"#ff9800","fill":"#ff9800","fillOpacity":0.1}}
{"id":"DATUM-1","kind":"POINT","source":"ASW","identity":"SUSPECT","label":"DATUM","ttlSec":0,"geometry":{"position":{"range":9,"bearing":150}}}
```

## 5. GeoJSON (one message)

Topic: `c2.zones`. File: `5-geojson-zones.jsonl`. A FeatureCollection with a polygon zone and an anchorage point.

```json
{"type":"FeatureCollection","features":[{"type":"Feature","id":"GJ-ZONE","geometry":{"type":"Polygon","coordinates":[[[15.44502,36.46527],[15.61467,36.5],[15.62863,36.37459],[15.44502,36.46527]]]},"properties":{"label":"GEOJSON ZONE","identity":"NEUTRAL","source":"GIS","ttlSec":0}},{"type":"Feature","id":"GJ-ANCH","geometry":{"type":"Point","coordinates":[14.92724,36.4202]},"properties":{"label":"ANCHORAGE","identity":"NEUTRAL","source":"GIS","ttlSec":0}}]}
```

## 6. Legacy flat format

Topic: `radar.legacy-plots`. File: `6-legacy-plot.jsonl`. Mapped by the legacyPlot adapter to track L777.

```json
{"trackNo":777,"rng":7.5,"brg":250,"crs":90,"spd":14,"ident":"H"}
```

## 7. NMEA 0183 radar

Topic: `radar.nmea`. File: `7-nmea-radar.nmea`. Gyro heading ($HEHDT), GPS ($GPRMC), three ARPA targets ($RATTM) and one lat/lon target ($RATLL).

```text
$HEHDT,45.0,T*1E
$GPRMC,210427.11,A,3630.0000,N,01512.0000,E,16.0,45.0,300926,,,A*55
$RATTM,01,5.20,60.0,T,8.0,190.0,T,1.10,22.0,N,,T,,210427.11,A*05
$RATTM,02,3.10,175.0,T,3.0,300.0,T,0.30,9.5,N,FISHING,T,,210427.11,A*5D
$RATTM,03,9.80,290.0,T,12.0,80.0,T,,,N,,T,,210427.11,A*37
$RATLL,04,3636.0624,N,01507.6458,E,BUOY,210427.11,T,*21
```

## 8. NMEA: target lost

Topic: `radar.nmea`. File: `8-nmea-target-lost.nmea`. Status L removes target RA-03.

```text
$RATTM,03,9.80,290.0,T,12.0,80.0,T,,,N,,L,,210427.11,A*2F
```

## 9. AIS

Topic: `ais.nmea`. File: `9-ais.nmea`. Vessel names (message 24) and positions (message 1) for three ships.

```text
!AIVDM,1,1,,B,H3cc>00m<>05E8u8400000000000,0*3E
!AIVDM,1,1,,A,13cc>00P2A166GHE1n;9i7ln0000,0*43
!AIVDM,1,1,,B,H815<80pu8@T>118T@D000000000,0*2A
!AIVDM,1,1,,A,1815<80P1h16eg<Dp21dq:Dn0000,0*1D
!AIVDM,1,1,,B,H3K>Q80l58T60d00000000000000,0*25
!AIVDM,1,1,,A,13K>Q87P0u14wq`DmQwRF1pn0000,0*4D
```

## 10. Invalid messages

Topic: `radar.geometry`. File: `10-invalid.jsonl`. These are rejected on purpose. They appear in the Rejected tab with the reason.

```json
{"id":"BAD-1","kind":"CIRCLE","geometry":{}}
{"id":"BAD-2","kind":"POINT","geometry":{"position":{"lat":95,"lon":15}}}
```

## Notes

- **Own ship from two sources.** The JSON own ship (step 1) and the NMEA own ship (`$GPRMC` /
  `$HEHDT` in step 7) both update id `OWNSHIP`. Whichever has the newer timestamp wins, and older
  updates are ignored. To switch to the NMEA own ship, send `{"id":"OWNSHIP","action":"DELETE"}`
  to `radar.ownship` first.
- **Clearing the picture.** Run `curl -X DELETE localhost:4000/api/geometries`.
- **Regenerating these files.** Run `npm --prefix server run generate-samples`. The NMEA and AIS
  checksums are computed for you, so edit the generator rather than the sentences.
