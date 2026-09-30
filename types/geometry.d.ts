/**
 * Type definitions for the naval radar geometry model.
 *
 * Two layers:
 *  1. Input messages   (`GeometryMessage`)  - what producers publish to Kafka (canonical adapter)
 *                                              or POST to /api/ingest.
 *  2. Canonical objects (`GeometryObject`)  - what the server stores and sends to the UI
 *                                              (Socket.IO, REST, MongoDB). Produced by
 *                                              server/src/services/normalizer.js.
 *
 * Both are discriminated unions on `kind`, so `switch (obj.kind)` narrows `geometry`
 * and `properties` to the right shape.
 *
 * Units: ranges and distances in nautical miles (NM), bearings/courses in degrees
 * true [0, 360), speeds in knots, times in epoch milliseconds (UTC).
 */

// =====================================================================
// Enumerations
// =====================================================================

export type GeometryKind =
  | 'OWNSHIP'
  | 'TRACK'
  | 'POINT'
  | 'LINE'
  | 'POLYGON'
  | 'CIRCLE'
  | 'ELLIPSE'
  | 'SECTOR'
  | 'BEARING';

/** Standard identities (MIL-STD-2525 / STANAG 1241 affiliations). */
export type Identity =
  | 'FRIEND'
  | 'ASSUMED_FRIEND'
  | 'NEUTRAL'
  | 'UNKNOWN'
  | 'PENDING'
  | 'SUSPECT'
  | 'HOSTILE';

/** Aliases the normaliser also accepts for `kind` (case-insensitive, spaces/hyphens -> underscores). */
export type GeometryKindAlias =
  | 'OWN_SHIP'
  | 'CONTACT'
  | 'TARGET'
  | 'PLOT'
  | 'MARKER'
  | 'WAYPOINT'
  | 'POLYLINE'
  | 'LINESTRING'
  | 'ROUTE'
  | 'AREA'
  | 'ZONE'
  | 'RANGE_RING'
  | 'RING'
  | 'UNCERTAINTY'
  | 'ARC'
  | 'COVERAGE'
  | 'STROBE'
  | 'LOB'
  | 'LINE_OF_BEARING';

/** Aliases the normaliser also accepts for `identity`. Anything unrecognised becomes UNKNOWN. */
export type IdentityAlias = 'F' | 'FRIENDLY' | 'A' | 'N' | 'U' | 'UNK' | 'P' | 'S' | 'H' | 'ENEMY';

export type MessageAction = 'UPSERT' | 'DELETE';

/** Track domain - AIR tracks are drawn with the open-top air symbol. */
export type Domain = 'SURFACE' | 'AIR' | 'SUBSURFACE' | 'LAND';

// =====================================================================
// Positions
// =====================================================================

/** Absolute WGS84 position, decimal degrees. */
export interface GeoPosition {
  /** -90 .. 90 */
  lat: number;
  /** -180 .. 180 */
  lon: number;
}

/** Position relative to own ship's current position. Moves with the ship. */
export interface RelativePosition {
  /** Nautical miles, >= 0 */
  range: number;
  /** Degrees true, normalised to [0, 360) */
  bearing: number;
}

/** A normalised position, as found on every canonical object. */
export type Position = GeoPosition | RelativePosition;

/** GeoJSON coordinate order: [longitude, latitude]. */
export type LonLatTuple = [lon: number, lat: number];

/** Absolute position forms accepted on input. */
export type GeoPositionInput =
  | GeoPosition
  | { latitude: number; longitude: number }
  | { lat: number; lng: number }
  | { lat: number; long: number }
  | LonLatTuple;

type BearingField = { bearing: number } | { brg: number } | { azimuth: number };
type RangeField =
  | { range: number } // NM
  | { rangeNm: number }
  | { rangeKm: number }
  | { rangeM: number }
  | { rangeYd: number };

/** Relative position forms accepted on input (range in any listed unit, converted to NM). */
export type RelativePositionInput = RangeField & BearingField;

/** Any position accepted on input. Numeric strings (e.g. "36.5") are also tolerated. */
export type PositionInput = GeoPositionInput | RelativePositionInput;

/** Two or more positions. */
export type LinePoints<P = Position> = [P, P, ...P[]];
/** Three or more positions; the ring is implicitly closed (do not repeat the first point). */
export type PolygonPoints<P = Position> = [P, P, P, ...P[]];

// =====================================================================
// Geometry blocks (canonical, i.e. after normalisation)
// =====================================================================

export interface OwnshipGeometry {
  /** Own ship must be absolute - it is the reference for all relative positions. */
  position: GeoPosition;
}

export interface TrackGeometry {
  position: Position;
}

export interface PointGeometry {
  position: Position;
}

export interface LineGeometry {
  points: LinePoints;
}

export interface PolygonGeometry {
  points: PolygonPoints;
}

export interface CircleGeometry {
  /** Defaults to own ship ({ range: 0, bearing: 0 }) when omitted on input. */
  center: Position;
  /** NM, > 0 */
  radius: number;
}

export interface EllipseGeometry {
  /** Defaults to own ship when omitted on input. */
  center: Position;
  /** NM, > 0 */
  semiMajor: number;
  /** NM, > 0 */
  semiMinor: number;
  /** Bearing of the major axis, degrees true [0, 360). Defaults to 0. */
  orientation: number;
}

export interface SectorGeometry {
  /** Defaults to own ship when omitted on input. */
  center: Position;
  /** The arc runs clockwise from startBearing to endBearing (degrees true). Equal values = full circle. */
  startBearing: number;
  endBearing: number;
  /** NM, >= 0 and < outerRadius. Defaults to 0 (a pie slice). */
  innerRadius: number;
  /** NM, > 0 */
  outerRadius: number;
}

export interface BearingGeometry {
  /** Defaults to own ship when omitted on input. */
  origin: Position;
  /** Degrees true [0, 360) */
  bearing: number;
  /** NM, > 0; null draws the line to the edge of the scope. */
  length: number | null;
}

/** Maps each kind to its canonical geometry block. */
export interface GeometryByKind {
  OWNSHIP: OwnshipGeometry;
  TRACK: TrackGeometry;
  POINT: PointGeometry;
  LINE: LineGeometry;
  POLYGON: PolygonGeometry;
  CIRCLE: CircleGeometry;
  ELLIPSE: EllipseGeometry;
  SECTOR: SectorGeometry;
  BEARING: BearingGeometry;
}

// =====================================================================
// Properties (free-form; these are the keys the UI understands)
// =====================================================================

/** Arbitrary key/values shown in the details panel. */
export interface BaseProperties {
  [key: string]: unknown;
}

export interface OwnshipProperties extends BaseProperties {
  /** Gyro heading, degrees true - used for head-up mode and relative NMEA bearings. */
  heading?: number;
  /** Course over ground, degrees true */
  course?: number;
  /** Speed, knots */
  speed?: number;
}

export interface TrackProperties extends BaseProperties {
  /** Course, degrees true - with `speed` draws the velocity leader. `cog` / `heading` are fallbacks. */
  course?: number | null;
  cog?: number;
  heading?: number | null;
  /** Speed, knots. `sog` is a fallback. */
  speed?: number | null;
  sog?: number;
  domain?: Domain;
  platform?: string;
  /** Feet */
  altitude?: number;
  /** Tracker quality, 0-9 */
  quality?: number;
}

/** Properties set by the nmea0183 adapter for $--TTM / $--TLL targets. */
export interface ArpaTrackProperties extends TrackProperties {
  targetNumber: number;
  /** Closest point of approach, NM */
  cpaNm?: number | null;
  /** Time to CPA, minutes (negative = CPA has passed) */
  tcpaMin?: number | null;
  status: 'TRACKING' | 'ACQUIRING' | string;
  acquisition?: 'AUTO' | 'MANUAL' | 'REPORTED' | null;
  reference?: 'REFERENCE TARGET';
}

/** Properties set by the nmea0183 adapter for AIS (!AIVDM) targets. */
export interface AisTrackProperties extends TrackProperties {
  /** Maritime Mobile Service Identity */
  mmsi: number;
  navStatus?: string;
  callsign?: string;
  /** ITU-R M.1371 ship type code */
  shipType?: number;
  destination?: string;
  /** 1, 2, 3 (class A) or 18 (class B) */
  aisMessageType: number;
}

export interface BearingProperties extends BaseProperties {
  emitter?: string;
  frequencyMHz?: number;
}

export interface PropertiesByKind {
  OWNSHIP: OwnshipProperties;
  TRACK: TrackProperties | ArpaTrackProperties | AisTrackProperties;
  POINT: BaseProperties;
  LINE: BaseProperties;
  POLYGON: BaseProperties;
  CIRCLE: BaseProperties;
  ELLIPSE: BaseProperties;
  SECTOR: BaseProperties;
  BEARING: BearingProperties;
}

// =====================================================================
// Style
// =====================================================================

export interface GeometryStyle {
  /** Stroke colour (CSS). Defaults to the identity colour. */
  color?: string;
  /** Fill colour (CSS). No fill when omitted. */
  fill?: string;
  /** 0..1, default 0.15 when `fill` is set */
  fillOpacity?: number;
  /** Stroke width, px */
  width?: number;
  dashed?: boolean;
}

// =====================================================================
// Canonical objects (server -> UI)
// =====================================================================

interface CanonicalBase<K extends GeometryKind> {
  id: string;
  kind: K;
  /** Sensor / system that produced the object */
  source: string;
  /** Kafka topic it arrived on, "http" for /api/ingest */
  topic: string | null;
  identity: Identity;
  /** Text drawn next to the symbol (defaults to id) */
  label: string;
  /** Sensor time, epoch ms. Updates older than the stored one are ignored. */
  timestamp: number;
  /** Server receive time, epoch ms. TTL expiry is measured from this. */
  receivedAt: number;
  /** Seconds without update before the object is dropped; null = server default, 0 = never. */
  ttlSec: number | null;
  style: GeometryStyle;
  geometry: GeometryByKind[K];
  properties: PropertiesByKind[K];
}

export interface TrailPoint {
  position: Position;
  timestamp: number;
}

export type OwnshipObject = CanonicalBase<'OWNSHIP'>;
export interface TrackObject extends CanonicalBase<'TRACK'> {
  /** Previous positions, oldest first (max TRACK_HISTORY_LENGTH). */
  trail: TrailPoint[];
}
export type PointObject = CanonicalBase<'POINT'>;
export type LineObject = CanonicalBase<'LINE'>;
export type PolygonObject = CanonicalBase<'POLYGON'>;
export type CircleObject = CanonicalBase<'CIRCLE'>;
export type EllipseObject = CanonicalBase<'ELLIPSE'>;
export type SectorObject = CanonicalBase<'SECTOR'>;
export type BearingObject = CanonicalBase<'BEARING'>;

/** One object of the live tactical picture, as sent by the server. */
export type GeometryObject =
  | OwnshipObject
  | TrackObject
  | PointObject
  | LineObject
  | PolygonObject
  | CircleObject
  | EllipseObject
  | SectorObject
  | BearingObject;

/** Look up the object type for a kind: GeometryObjectOf<'SECTOR'> = SectorObject. */
export type GeometryObjectOf<K extends GeometryKind> = Extract<GeometryObject, { kind: K }>;

// =====================================================================
// Input messages (producer -> Kafka / POST /api/ingest)
// =====================================================================

interface InputBase<K extends GeometryKind | GeometryKindAlias> {
  /** Unique object id. Use it as the Kafka message key so updates stay ordered. */
  id: string | number;
  kind: K;
  action?: 'UPSERT';
  source?: string;
  identity?: Identity | IdentityAlias;
  label?: string;
  /** ISO 8601 string, epoch ms, or epoch seconds. Defaults to receive time. */
  timestamp?: string | number;
  ttlSec?: number;
  style?: GeometryStyle;
}

export interface OwnshipGeometryInput {
  position: GeoPositionInput;
}
export interface PositionGeometryInput {
  position: PositionInput;
}
export interface LineGeometryInput {
  points: LinePoints<PositionInput>;
}
export interface PolygonGeometryInput {
  points: PolygonPoints<PositionInput>;
}
export interface CircleGeometryInput {
  center?: PositionInput;
  radius: number;
}
export interface EllipseGeometryInput {
  center?: PositionInput;
  semiMajor: number;
  semiMinor: number;
  orientation?: number;
}
export type SectorGeometryInput = {
  center?: PositionInput;
  startBearing: number;
  endBearing: number;
  innerRadius?: number;
} & ({ outerRadius: number } | { radius: number });
export interface BearingGeometryInput {
  origin?: PositionInput;
  bearing: number;
  length?: number | null;
}

export interface OwnshipMessage extends InputBase<'OWNSHIP' | 'OWN_SHIP'> {
  geometry: OwnshipGeometryInput;
  properties?: OwnshipProperties;
}
export interface TrackMessage extends InputBase<'TRACK' | 'CONTACT' | 'TARGET'> {
  geometry: PositionGeometryInput;
  properties?: TrackProperties;
}
export interface PointMessage extends InputBase<'POINT' | 'PLOT' | 'MARKER' | 'WAYPOINT'> {
  geometry: PositionGeometryInput;
  properties?: BaseProperties;
}
export interface LineMessage extends InputBase<'LINE' | 'POLYLINE' | 'LINESTRING' | 'ROUTE'> {
  geometry: LineGeometryInput;
  properties?: BaseProperties;
}
export interface PolygonMessage extends InputBase<'POLYGON' | 'AREA' | 'ZONE'> {
  geometry: PolygonGeometryInput;
  properties?: BaseProperties;
}
export interface CircleMessage extends InputBase<'CIRCLE' | 'RANGE_RING' | 'RING'> {
  geometry: CircleGeometryInput;
  properties?: BaseProperties;
}
export interface EllipseMessage extends InputBase<'ELLIPSE' | 'UNCERTAINTY'> {
  geometry: EllipseGeometryInput;
  properties?: BaseProperties;
}
export interface SectorMessage extends InputBase<'SECTOR' | 'ARC' | 'COVERAGE'> {
  geometry: SectorGeometryInput;
  properties?: BaseProperties;
}
export interface BearingMessage extends InputBase<'BEARING' | 'STROBE' | 'LOB' | 'LINE_OF_BEARING'> {
  geometry: BearingGeometryInput;
  properties?: BearingProperties;
}

/** Removes an object from the picture. Only `id` is required. */
export interface DeleteMessage {
  id: string | number;
  action: 'DELETE';
  kind?: GeometryKind;
  source?: string;
  timestamp?: string | number;
}

/** A single canonical input message. */
export type GeometryMessage =
  | OwnshipMessage
  | TrackMessage
  | PointMessage
  | LineMessage
  | PolygonMessage
  | CircleMessage
  | EllipseMessage
  | SectorMessage
  | BearingMessage
  | DeleteMessage;

// ---------------------------------------------------------------- GeoJSON input (RFC 7946)

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: LonLatTuple;
}
export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: LinePoints<LonLatTuple>;
}
export interface GeoJsonPolygon {
  type: 'Polygon';
  /** Outer ring only; a closing point equal to the first is dropped. Holes are ignored. */
  coordinates: [PolygonPoints<LonLatTuple>, ...LonLatTuple[][]];
}
export type GeoJsonGeometry = GeoJsonPoint | GeoJsonLineString | GeoJsonPolygon;

/**
 * GeoJSON Feature. Point -> POINT (or TRACK/OWNSHIP if `properties.kind` says so),
 * LineString -> LINE, Polygon -> POLYGON. Other message fields go in `properties`.
 */
export interface GeoJsonFeatureMessage {
  type: 'Feature';
  id?: string | number;
  geometry: GeoJsonGeometry;
  properties: {
    id?: string | number;
    kind?: 'POINT' | 'TRACK' | 'OWNSHIP' | 'LINE' | 'POLYGON';
    source?: string;
    identity?: Identity | IdentityAlias;
    label?: string;
    timestamp?: string | number;
    ttlSec?: number;
    style?: GeometryStyle;
    [key: string]: unknown;
  };
}

export interface GeoJsonFeatureCollectionMessage {
  type: 'FeatureCollection';
  features: GeoJsonFeatureMessage[];
}

/**
 * Everything the `canonical` adapter accepts as one Kafka message value.
 */
export type CanonicalPayload =
  | GeometryMessage
  | GeoJsonFeatureMessage
  | GeoJsonFeatureCollectionMessage
  | Array<GeometryMessage | GeoJsonFeatureMessage>
  | { items: Array<GeometryMessage | GeoJsonFeatureMessage> }
  | { messages: Array<GeometryMessage | GeoJsonFeatureMessage> };

/** Flat payload understood by the `legacyPlot` adapter. */
export interface LegacyPlotMessage {
  trackNo: number;
  /** Range, NM */
  rng: number;
  /** Bearing, degrees true */
  brg: number;
  crs?: number;
  spd?: number;
  ident?: IdentityAlias | Identity;
  q?: number;
  /** Epoch seconds */
  ts?: number;
  sensor?: string;
  /** true -> DELETE */
  dropped?: boolean;
}

// =====================================================================
// Server API payloads
// =====================================================================

export type KafkaState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'disabled'
  | 'stopped'
  /** The browser demo build */
  | 'demo';

export interface KafkaStatus {
  state: KafkaState;
  brokers: string[];
  topics: Array<{ topic: string; adapter: 'canonical' | 'nmea0183' | 'legacyPlot' | string }>;
  error: string | null;
  since?: number;
}

export interface IngestStats {
  received: number;
  accepted: number;
  /** Out-of-order updates and deletes of unknown ids */
  ignored: number;
  rejected: number;
  byTopic: Record<string, number>;
  lastMessageAt: number | null;
  ratePerSec: number;
}

/** Socket.IO "status" event, emitted every second. */
export interface StatusPayload {
  kafka: KafkaStatus;
  stats: IngestStats;
  objects: number;
  serverTime: number;
}

/** Socket.IO "geometry:batch" event. */
export interface GeometryBatch {
  upserts: GeometryObject[];
  /** Ids removed by DELETE messages, TTL expiry or the API */
  deletes: string[];
}

/** Events the server sends (usable as socket.io-client's ServerToClientEvents). */
export interface ServerToClientEvents {
  snapshot: (objects: GeometryObject[]) => void;
  'geometry:batch': (batch: GeometryBatch) => void;
  status: (status: StatusPayload) => void;
}

/** Events the client may send. */
export interface ClientToServerEvents {
  'snapshot:request': () => void;
}

/** GET /api/errors item */
export interface RejectedMessage {
  at: number;
  topic: string;
  offset?: string;
  reason: string;
  /** Payload excerpt, max 500 characters */
  payload: string;
}

/** GET /api/geometries/:id/history item (MongoDB) */
export interface HistoryEvent {
  objectId: string;
  action: MessageAction;
  kind?: GeometryKind | null;
  source?: string;
  topic?: string | null;
  identity?: Identity;
  timestamp: number;
  geometry?: GeometryByKind[GeometryKind];
  properties?: BaseProperties;
  createdAt?: string;
}

/** POST /api/ingest response */
export interface IngestResult {
  accepted: number;
  rejected: number;
  errors: string[];
}

/** GET /api/health */
export interface HealthResponse {
  status: 'ok';
  uptimeSec: number;
  mongo: 'connected' | 'disconnected';
  kafka: KafkaStatus;
  objects: number;
}
