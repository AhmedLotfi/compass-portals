/** Geometry of the hero compass, in a viewBox of -200 -200 400 400 with north at the top. */

export interface RosePoint {
  id: string;
  /** The shaded half of the point. */
  dark: string;
  /** The paper half of the point. */
  light: string;
}

export interface CompassLetter {
  label: string;
  x: number;
  y: number;
  north: boolean;
}

export interface TickLine {
  /** Position clockwise from north; drives the staggered sweep-in. */
  index: number;
  tier: 'minor' | 'medium' | 'major';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CompassGeometry {
  ticks: TickLine[];
  rose: RosePoint[];
  letters: CompassLetter[];
}

const round = (value: number) => Math.round(value * 100) / 100 || 0;

/** A point at `radius` along a compass bearing (0° = north, clockwise). */
export function polar(radius: number, bearing: number): [number, number] {
  const radians = (bearing * Math.PI) / 180;
  return [round(radius * Math.sin(radians)), round(-radius * Math.cos(radians))];
}

const pair = ([x, y]: [number, number]) => `${x} ${y}`;

const TICK_LENGTH = { minor: 6, medium: 10, major: 17 } as const;

/** Radial ticks every 5°, longer every 10° and 30°, ordered clockwise from north. */
export function tickLines(outer: number): TickLine[] {
  return Array.from({ length: 72 }, (_, index) => {
    const bearing = index * 5;
    const tier = bearing % 30 === 0 ? 'major' : bearing % 10 === 0 ? 'medium' : 'minor';
    const [x1, y1] = polar(outer, bearing);
    const [x2, y2] = polar(outer - TICK_LENGTH[tier], bearing);
    return { index, tier, x1, y1, x2, y2 };
  });
}

/** A compass-rose point: two triangles meeting along the centre line, one shaded. */
export function rosePoint(bearing: number, length: number, shoulder: number): RosePoint {
  const tip = pair(polar(length, bearing));
  return {
    id: `p${bearing}`,
    dark: `M0 0L${tip}L${pair(polar(shoulder, bearing + 45))}Z`,
    light: `M0 0L${tip}L${pair(polar(shoulder, bearing - 45))}Z`,
  };
}

const TICK_OUTER = 176;

export const compassGeometry: CompassGeometry = {
  ticks: tickLines(TICK_OUTER),
  // Drawn back to front: minor points, then intercardinal, then cardinal.
  rose: [
    ...[22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((b) => rosePoint(b, 70, 13)),
    ...[45, 135, 225, 315].map((b) => rosePoint(b, 104, 20)),
    ...[0, 90, 180, 270].map((b) => rosePoint(b, 134, 25)),
  ],
  letters: (['N', 'E', 'S', 'W'] as const).map((label, i) => {
    const [x, y] = polar(151, i * 90);
    return { label, x, y, north: label === 'N' };
  }),
};
