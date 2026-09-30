/**
 * NMEA 0183 / AIS sentence encoders used by the simulator and the sample
 * generator. The decoder lives in src/kafka/adapters/nmea0183.js.
 */
import { checksum } from '../../src/kafka/adapters/nmea0183.js';

const pad = (n, w, d = 0) => Math.abs(n).toFixed(d).padStart(w + (d ? d + 1 : 0), '0');

export function sentence(prefix, fields) {
  const body = [prefix, ...fields].join(',');
  return `${body[0] === '!' || body[0] === '$' ? '' : '$'}${body}*${checksum(body.replace(/^[$!]/, ''))}`;
}

const nmeaLat = (lat) => {
  const a = Math.abs(lat);
  const d = Math.floor(a);
  return [`${pad(d, 2)}${pad((a - d) * 60, 2, 4)}`, lat >= 0 ? 'N' : 'S'];
};
const nmeaLon = (lon) => {
  const a = Math.abs(lon);
  const d = Math.floor(a);
  return [`${pad(d, 3)}${pad((a - d) * 60, 2, 4)}`, lon >= 0 ? 'E' : 'W'];
};
const hhmmss = (t) => {
  const d = new Date(t);
  return `${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${pad(d.getUTCSeconds() + d.getUTCMilliseconds() / 1000, 2, 2)}`;
};
const ddmmyy = (t) => {
  const d = new Date(t);
  return `${pad(d.getUTCDate(), 2)}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCFullYear() % 100, 2)}`;
};
const f1 = (v) => (v === null || v === undefined ? '' : Number(v).toFixed(1));

/** $GPRMC - own ship position, SOG, COG */
export const rmc = ({ lat, lon, sog, cog, t = Date.now() }) =>
  sentence('$GPRMC', [hhmmss(t), 'A', ...nmeaLat(lat), ...nmeaLon(lon), f1(sog), f1(cog), ddmmyy(t), '', '', 'A']);

/** $HEHDT - gyro heading */
export const hdt = (heading) => sentence('$HEHDT', [f1(heading), 'T']);

/** $RATTM - ARPA tracked target, range in NM, bearing/course true */
export const ttm = ({ number, range, bearing, speed, course, cpa = '', tcpa = '', name = '', status = 'T', t = Date.now() }) =>
  sentence('$RATTM', [
    pad(number, 2), range.toFixed(2), f1(bearing), 'T', f1(speed), f1(course), 'T',
    cpa === '' ? '' : Number(cpa).toFixed(2), tcpa === '' ? '' : Number(tcpa).toFixed(1),
    'N', name, status, '', hhmmss(t), 'A',
  ]);

/** $RATLL - ARPA target lat/lon */
export const tll = ({ number, lat, lon, name = '', status = 'T', t = Date.now() }) =>
  sentence('$RATLL', [pad(number, 2), ...nmeaLat(lat), ...nmeaLon(lon), name, hhmmss(t), status, '']);

// ------------------------------------------------------------------ AIS

class BitWriter {
  bits = '';
  uint(v, len) {
    this.bits += (Math.round(v) >>> 0).toString(2).padStart(len, '0').slice(-len);
    return this;
  }
  int(v, len) {
    const n = Math.round(v);
    return this.uint(n < 0 ? 2 ** len + n : n, len);
  }
  text(s, len) {
    const chars = (s ?? '').toUpperCase().padEnd(len / 6, '@').slice(0, len / 6);
    for (const ch of chars) {
      const c = ch.charCodeAt(0);
      this.uint(c >= 64 ? c - 64 : c, 6);
    }
    return this;
  }
  armour() {
    const fill = (6 - (this.bits.length % 6)) % 6;
    const bits = this.bits + '0'.repeat(fill);
    let out = '';
    for (let i = 0; i < bits.length; i += 6) {
      const v = parseInt(bits.slice(i, i + 6), 2);
      out += String.fromCharCode(v < 40 ? v + 48 : v + 56);
    }
    return { payload: out, fill };
  }
}

const vdm = ({ payload, fill }, channel = 'A') => sentence('!AIVDM', ['1', '1', '', channel, payload, String(fill)]);

/** AIS message 1 - class A position report */
export function aisPosition({ mmsi, lat, lon, sog, cog, heading, status = 0, channel = 'A' }) {
  const w = new BitWriter()
    .uint(1, 6).uint(0, 2).uint(mmsi, 30).uint(status, 4).int(-128, 8)
    .uint(Math.min(1022, sog * 10), 10).uint(0, 1)
    .int(lon * 600000, 28).int(lat * 600000, 27)
    .uint(cog * 10, 12).uint(heading ?? 511, 9).uint(new Date().getUTCSeconds(), 6)
    .uint(0, 2).uint(0, 3).uint(0, 1).uint(0, 19);
  return vdm(w.armour(), channel);
}

/** AIS message 24 part A - static data (vessel name), single sentence */
export function aisName({ mmsi, name, channel = 'B' }) {
  const w = new BitWriter().uint(24, 6).uint(0, 2).uint(mmsi, 30).uint(0, 2).text(name, 120).uint(0, 8);
  return vdm(w.armour(), channel);
}
