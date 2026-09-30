/**
 * Colours and symbol shapes, loosely following NTDS / MIL-STD-2525 conventions:
 *   friend  = circle (cyan)      hostile = diamond (red)
 *   neutral = square (green)     unknown = quatrefoil (yellow)
 * AIR tracks use the upper half of the frame only.
 * Dashed frames mark "assumed" (assumed friend, suspect, pending).
 */

export const IDENTITY_COLORS = {
  FRIEND: '#4fc3f7',
  ASSUMED_FRIEND: '#4fc3f7',
  NEUTRAL: '#66bb6a',
  UNKNOWN: '#ffee58',
  PENDING: '#ffee58',
  SUSPECT: '#ff8a65',
  HOSTILE: '#ff4d4d',
};

export const IDENTITY_LABELS = {
  FRIEND: 'Friend',
  ASSUMED_FRIEND: 'Assumed friend',
  NEUTRAL: 'Neutral',
  UNKNOWN: 'Unknown',
  PENDING: 'Pending',
  SUSPECT: 'Suspect',
  HOSTILE: 'Hostile',
};

export const KIND_LABELS = {
  OWNSHIP: 'Own ship',
  TRACK: 'Tracks',
  POINT: 'Points / markers',
  LINE: 'Lines / routes',
  POLYGON: 'Areas / zones',
  CIRCLE: 'Circles / rings',
  ELLIPSE: 'Ellipses (AOU)',
  SECTOR: 'Sectors / arcs',
  BEARING: 'Bearing lines (LOB)',
};

export const identityColor = (identity) => IDENTITY_COLORS[identity] ?? IDENTITY_COLORS.UNKNOWN;

export const colorOf = (obj) => obj.style?.color ?? identityColor(obj.identity);

export const isDashedIdentity = (identity) =>
  identity === 'ASSUMED_FRIEND' || identity === 'SUSPECT' || identity === 'PENDING';

/**
 * SVG path of the symbol frame centred at 0,0 with half-size s.
 */
export function framePath(identity, s, air = false) {
  switch (identity) {
    case 'FRIEND':
    case 'ASSUMED_FRIEND':
      return air
        ? `M${-s},${s * 0.3} A${s},${s} 0 0 1 ${s},${s * 0.3}`
        : `M${-s},0 A${s},${s} 0 1 1 ${s},0 A${s},${s} 0 1 1 ${-s},0Z`;
    case 'HOSTILE':
    case 'SUSPECT':
      return air ? `M${-s},${s * 0.3} L0,${-s} L${s},${s * 0.3}` : `M0,${-s} L${s},0 L0,${s} L${-s},0Z`;
    case 'NEUTRAL':
      return air
        ? `M${-s * 0.8},${s * 0.4} L${-s * 0.8},${-s * 0.8} L${s * 0.8},${-s * 0.8} L${s * 0.8},${s * 0.4}`
        : `M${-s * 0.8},${-s * 0.8} H${s * 0.8} V${s * 0.8} H${-s * 0.8}Z`;
    default: {
      // quatrefoil
      const r = s * 0.45;
      const c = s * 0.55;
      if (air) return `M${-c - r},${r * 0.2} A${r},${r} 0 0 1 ${-c + r * 0.3},${-c + r * 0.1} A${r},${r} 0 0 1 ${c - r * 0.3},${-c + r * 0.1} A${r},${r} 0 0 1 ${c + r},${r * 0.2}`;
      return [
        `M${-c},${-c + r * 0.2}`,
        `A${r},${r} 0 0 1 ${c},${-c + r * 0.2}`,
        `A${r},${r} 0 0 1 ${c},${c - r * 0.2}`,
        `A${r},${r} 0 0 1 ${-c},${c - r * 0.2}`,
        `A${r},${r} 0 0 1 ${-c},${-c + r * 0.2}Z`,
      ].join(' ');
    }
  }
}
