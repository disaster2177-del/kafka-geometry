/**
 * NMEA 0183 adapter (IEC 61162-1) - the standard output of marine radars,
 * ARPA trackers, GPS, gyro compasses and AIS receivers.
 *
 * The Kafka message value is plain text: one sentence, or several separated by
 * newlines. Supported sentences:
 *
 *   $--RMC  position, course and speed over ground      -> OWNSHIP
 *   $--GGA  position fix                                 -> OWNSHIP
 *   $--HDT  true heading                                 -> OWNSHIP
 *   $--VTG  course and speed over ground                 -> OWNSHIP
 *   $--TTM  tracked target (range/bearing from own ship) -> TRACK (ARPA)
 *   $--TLL  target latitude/longitude                    -> TRACK (ARPA)
 *   !AIVDM / !AIVDO  AIS messages 1, 2, 3 (class A), 18 (class B), 5 and 24 (static data) -> TRACK
 *
 * Own ship state (heading, position) is shared between sentences because TTM
 * bearings may be relative to the ship's head.
 */

const OWNSHIP_ID = (typeof process !== 'undefined' && process.env?.NMEA_OWNSHIP_ID) || 'OWNSHIP';

// `time` = time of the last position fix. Sentences without their own time
// (HDT, VTG) reuse it so they never look newer than the next fix.
const own = { position: null, heading: null, course: null, speed: null, time: null };
const aisNames = new Map(); // mmsi -> { name, callsign, shipType }
const aisFragments = new Map(); // `${channel}-${seqId}` -> string[]

export default function nmea0183(value) {
  const text = typeof value === 'string' ? value : value?.sentence ?? value?.raw;
  if (typeof text !== 'string') throw new Error('Expected NMEA 0183 text');

  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const sentence = line.trim();
    if (!sentence) continue;
    out.push(...parseSentence(sentence));
  }
  return out;
}

// ------------------------------------------------------------------ framing

export function checksum(body) {
  let cs = 0;
  for (let i = 0; i < body.length; i += 1) cs ^= body.charCodeAt(i);
  return cs.toString(16).toUpperCase().padStart(2, '0');
}

function parseSentence(sentence) {
  // Strip an optional IEC 61162-450 / TAG block prefix: \s:radar1,c:1700000000*5B\$RATTM,...
  const start = sentence.search(/[$!]/);
  if (start < 0) throw new Error(`Not an NMEA sentence: "${sentence.slice(0, 40)}"`);
  const s = sentence.slice(start);

  const star = s.lastIndexOf('*');
  const body = star >= 0 ? s.slice(1, star) : s.slice(1);
  if (star >= 0) {
    const expected = s.slice(star + 1, star + 3).toUpperCase();
    if (checksum(body) !== expected) throw new Error(`NMEA checksum mismatch in "${s}"`);
  }

  const fields = body.split(',');
  const address = fields[0];
  const talker = address.slice(0, 2);
  const type = address.slice(2);

  if (s[0] === '!' && (type === 'VDM' || type === 'VDO')) return parseVdm(fields, type === 'VDO');

  switch (type) {
    case 'RMC':
      return parseRmc(fields, talker);
    case 'GGA':
      return parseGga(fields, talker);
    case 'HDT':
      return parseHdt(fields, talker);
    case 'VTG':
      return parseVtg(fields, talker);
    case 'TTM':
      return parseTtm(fields, talker);
    case 'TLL':
      return parseTll(fields, talker);
    default:
      return []; // other sentences are valid NMEA but carry no geometry
  }
}

// ------------------------------------------------------------------ helpers

const num = (v) => (v === undefined || v === '' ? null : Number(v));

/** ddmm.mmmm + N/S -> decimal degrees */
function nmeaLat(v, hemi) {
  if (!v) return null;
  const deg = Number(v.slice(0, 2)) + Number(v.slice(2)) / 60;
  return hemi === 'S' ? -deg : deg;
}

/** dddmm.mmmm + E/W -> decimal degrees */
function nmeaLon(v, hemi) {
  if (!v) return null;
  const deg = Number(v.slice(0, 3)) + Number(v.slice(3)) / 60;
  return hemi === 'W' ? -deg : deg;
}

/** hhmmss.ss (+ optional ddmmyy) -> epoch ms. Without a date, today (UTC) is assumed. */
function nmeaTime(hhmmss, ddmmyy) {
  if (!hhmmss || hhmmss.length < 6) return Date.now();
  const now = new Date();
  let y = now.getUTCFullYear();
  let mo = now.getUTCMonth();
  let d = now.getUTCDate();
  if (ddmmyy && ddmmyy.length === 6) {
    d = Number(ddmmyy.slice(0, 2));
    mo = Number(ddmmyy.slice(2, 4)) - 1;
    y = 2000 + Number(ddmmyy.slice(4, 6));
  }
  const ms = Math.round(Number(`0${hhmmss.slice(6)}`) * 1000);
  const t = Date.UTC(y, mo, d, Number(hhmmss.slice(0, 2)), Number(hhmmss.slice(2, 4)), Number(hhmmss.slice(4, 6)), ms);
  // A time-only sentence just after midnight may belong to "yesterday".
  return !ddmmyy && t - Date.now() > 12 * 3600e3 ? t - 86400e3 : t;
}

function ownshipMessage(source, timestamp) {
  if (!own.position) return [];
  return [
    {
      id: OWNSHIP_ID,
      kind: 'OWNSHIP',
      source,
      identity: 'FRIEND',
      label: 'OWN SHIP',
      timestamp,
      geometry: { position: own.position },
      properties: {
        heading: own.heading ?? own.course ?? 0,
        course: own.course ?? own.heading ?? 0,
        speed: own.speed ?? 0,
      },
    },
  ];
}

// ------------------------------------------------------------------ own ship

function parseRmc(f, talker) {
  // $GPRMC,hhmmss.ss,A,llll.ll,a,yyyyy.yy,a,sog,cog,ddmmyy,mv,mvE,mode*hh
  if (f[2] !== 'A') return []; // V = void / invalid fix
  own.position = { lat: nmeaLat(f[3], f[4]), lon: nmeaLon(f[5], f[6]) };
  if (num(f[7]) !== null) own.speed = num(f[7]);
  if (num(f[8]) !== null) own.course = num(f[8]);
  own.time = nmeaTime(f[1], f[9]);
  return ownshipMessage(`NMEA ${talker}RMC`, own.time);
}

function parseGga(f, talker) {
  // $GPGGA,hhmmss.ss,llll.ll,a,yyyyy.yy,a,quality,sats,hdop,alt,M,geoid,M,age,station*hh
  if (!f[6] || f[6] === '0') return []; // no fix
  own.position = { lat: nmeaLat(f[2], f[3]), lon: nmeaLon(f[4], f[5]) };
  own.time = nmeaTime(f[1]);
  return ownshipMessage(`NMEA ${talker}GGA`, own.time);
}

function parseHdt(f, talker) {
  // $HEHDT,hhh.h,T*hh
  if (num(f[1]) === null) return [];
  own.heading = num(f[1]);
  return ownshipMessage(`NMEA ${talker}HDT`, own.time ?? Date.now());
}

function parseVtg(f, talker) {
  // $GPVTG,cogT,T,cogM,M,sogN,N,sogK,K,mode*hh
  if (num(f[1]) !== null) own.course = num(f[1]);
  if (num(f[5]) !== null) own.speed = num(f[5]);
  return ownshipMessage(`NMEA ${talker}VTG`, own.time ?? Date.now());
}

// ------------------------------------------------------------------ ARPA / radar targets

const TARGET_STATUS = { L: 'LOST', Q: 'ACQUIRING', T: 'TRACKING' };
const ACQUISITION = { A: 'AUTO', M: 'MANUAL', R: 'REPORTED' };
const UNIT_TO_NM = { N: 1, K: 1 / 1.852, S: 0.868976 };

function toTrue(bearing, ref) {
  if (bearing === null) return null;
  if (ref !== 'R') return bearing;
  if (own.heading === null) throw new Error('Relative TTM bearing received before any own ship heading (HDT)');
  return (((bearing + own.heading) % 360) + 360) % 360;
}

function parseTtm(f, talker) {
  // $RATTM,nn,dist,brg,T/R,spd,crs,T/R,cpa,tcpa,unit,name,status,ref,hhmmss.ss,acq*hh
  const number = f[1];
  const id = `${talker}-${number}`;
  const status = TARGET_STATUS[f[12]] ?? f[12];
  if (status === 'LOST') return [{ id, action: 'DELETE', source: `${talker} ARPA` }];

  const unit = UNIT_TO_NM[f[10]] ?? 1;
  const range = num(f[2]);
  const bearing = toTrue(num(f[3]), f[4]);
  if (range === null || bearing === null) return [];

  return [
    {
      id,
      kind: 'TRACK',
      source: `${talker} ARPA`,
      identity: 'UNKNOWN',
      label: f[11] || `${talker}${number}`,
      timestamp: nmeaTime(f[14]),
      geometry: { position: { range: range * unit, bearing } },
      properties: {
        targetNumber: Number(number),
        course: toTrue(num(f[6]), f[7]),
        speed: num(f[5]) === null ? null : num(f[5]) * unit,
        cpaNm: num(f[8]) === null ? null : num(f[8]) * unit,
        tcpaMin: num(f[9]),
        status,
        acquisition: ACQUISITION[f[15]] ?? f[15] ?? null,
        reference: f[13] === 'R' ? 'REFERENCE TARGET' : undefined,
        domain: 'SURFACE',
      },
    },
  ];
}

function parseTll(f, talker) {
  // $RATLL,nn,llll.ll,a,yyyyy.yy,a,name,hhmmss.ss,status,ref*hh
  const number = f[1];
  const id = `${talker}-${number}`;
  const status = TARGET_STATUS[f[8]] ?? f[8];
  if (status === 'LOST') return [{ id, action: 'DELETE', source: `${talker} ARPA` }];
  return [
    {
      id,
      kind: 'TRACK',
      source: `${talker} ARPA`,
      identity: 'UNKNOWN',
      label: f[6] || `${talker}${number}`,
      timestamp: nmeaTime(f[7]),
      geometry: { position: { lat: nmeaLat(f[2], f[3]), lon: nmeaLon(f[4], f[5]) } },
      properties: { targetNumber: Number(number), status, domain: 'SURFACE' },
    },
  ];
}

// ------------------------------------------------------------------ AIS

/** De-armour the 6-bit ASCII payload into a bit string. */
function payloadBits(payload, fillBits) {
  let bits = '';
  for (const ch of payload) {
    let v = ch.charCodeAt(0) - 48;
    if (v > 40) v -= 8;
    bits += v.toString(2).padStart(6, '0');
  }
  return fillBits ? bits.slice(0, bits.length - fillBits) : bits;
}

const uint = (bits, start, len) => (bits.length < start + len ? null : parseInt(bits.slice(start, start + len), 2));

function int(bits, start, len) {
  const v = uint(bits, start, len);
  if (v === null) return null;
  return v >= 2 ** (len - 1) ? v - 2 ** len : v;
}

function text(bits, start, len) {
  let s = '';
  for (let i = start; i + 6 <= Math.min(start + len, bits.length); i += 6) {
    const c = parseInt(bits.slice(i, i + 6), 2);
    s += String.fromCharCode(c < 32 ? c + 64 : c);
  }
  return s.replace(/@+$/, '').trim();
}

const NAV_STATUS = [
  'Under way using engine', 'At anchor', 'Not under command', 'Restricted manoeuvrability',
  'Constrained by draught', 'Moored', 'Aground', 'Engaged in fishing', 'Under way sailing',
];

function parseVdm(f, own_) {
  // !AIVDM,fragments,fragmentNo,seqId,channel,payload,fillBits*hh
  const total = Number(f[1]);
  const index = Number(f[2]);
  const key = `${f[4]}-${f[3]}`;
  let payload = f[5];
  const fill = Number(f[6] ?? 0);

  if (total > 1) {
    const parts = aisFragments.get(key) ?? [];
    parts[index - 1] = payload;
    aisFragments.set(key, parts);
    if (parts.filter(Boolean).length < total) return [];
    aisFragments.delete(key);
    payload = parts.join('');
  }

  const bits = payloadBits(payload, fill);
  const type = uint(bits, 0, 6);
  const mmsi = uint(bits, 8, 30);
  if (!mmsi) return [];

  if (type === 5) {
    aisNames.set(mmsi, {
      ...aisNames.get(mmsi),
      callsign: text(bits, 70, 42),
      name: text(bits, 112, 120),
      shipType: uint(bits, 232, 8),
      destination: text(bits, 302, 120),
    });
    return [];
  }
  if (type === 24) {
    const part = uint(bits, 38, 2);
    const entry = { ...aisNames.get(mmsi) };
    if (part === 0) entry.name = text(bits, 40, 120);
    else {
      entry.shipType = uint(bits, 40, 8);
      entry.callsign = text(bits, 90, 42);
    }
    aisNames.set(mmsi, entry);
    return [];
  }

  let r;
  if (type >= 1 && type <= 3) {
    r = {
      status: uint(bits, 38, 4),
      sog: uint(bits, 50, 10),
      lon: int(bits, 61, 28),
      lat: int(bits, 89, 27),
      cog: uint(bits, 116, 12),
      hdg: uint(bits, 128, 9),
      cls: 'A',
    };
  } else if (type === 18) {
    r = {
      sog: uint(bits, 46, 10),
      lon: int(bits, 57, 28),
      lat: int(bits, 85, 27),
      cog: uint(bits, 112, 12),
      hdg: uint(bits, 124, 9),
      cls: 'B',
    };
  } else {
    return []; // other AIS messages (base stations, safety text, ...) are not drawn
  }

  const lat = r.lat / 600000;
  const lon = r.lon / 600000;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return []; // 91 / 181 = not available

  const statics = aisNames.get(mmsi) ?? {};
  const course = r.cog === 3600 ? null : r.cog / 10;
  const heading = r.hdg === 511 ? null : r.hdg;
  return [
    {
      id: `AIS-${mmsi}`,
      kind: own_ ? 'OWNSHIP' : 'TRACK',
      source: `AIS class ${r.cls}`,
      identity: own_ ? 'FRIEND' : 'NEUTRAL',
      label: statics.name || String(mmsi),
      geometry: { position: { lat, lon } },
      properties: {
        mmsi,
        course: course ?? heading,
        heading,
        speed: r.sog === 1023 ? null : r.sog / 10,
        navStatus: r.status === undefined ? undefined : NAV_STATUS[r.status] ?? `Status ${r.status}`,
        callsign: statics.callsign,
        shipType: statics.shipType,
        destination: statics.destination,
        aisMessageType: type,
        domain: 'SURFACE',
      },
    },
  ];
}
