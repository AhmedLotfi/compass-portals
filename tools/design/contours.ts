/**
 * Generates the topographic contour-line textures used as faint backgrounds (public/textures/*.svg).
 * Seeded, so the output is identical on every run. Every fifth line is an "index contour", drawn
 * heavier, as on a real topographic map.
 *
 *   node tools/design/contours.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { contours } from 'd3-contour';
import { createNoise2D } from 'simplex-noise';
import { optimize } from 'svgo';
import { ROOT } from '../content-sync/config.ts';

export interface TextureSpec {
  name: string;
  width: number;
  height: number;
  seed: number;
  /** Grid cells across the width; more cells = finer contours and a bigger file. */
  cells: number;
  levels: number;
  /** Noise frequency: higher = more, smaller hills. */
  frequency: number;
  /** Minor contours relative to index contours; the colour and strength come from CSS (base.css). */
  minorWeight: number;
  /** Simplification tolerance, in grid cells. */
  tolerance: number;
}

type Point = [number, number];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chaikin corner cutting on a closed ring: turns marching-squares zigzags into smooth lines. */
export function chaikin(ring: Point[], iterations: number): Point[] {
  let points = ring;
  for (let n = 0; n < iterations; n++) {
    const next: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i]!;
      const [x1, y1] = points[(i + 1) % points.length]!;
      next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
      next.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    points = next;
  }
  return points;
}

/** Douglas–Peucker simplification. */
export function simplifyLine(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0]!;
  const [bx, by] = points[points.length - 1]!;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]!;
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const distance = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= tolerance) return [points[0]!, points[points.length - 1]!];
  const left = simplifyLine(points.slice(0, index + 1), tolerance);
  const right = simplifyLine(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** A closed ring as quadratic curves through segment midpoints: smooth, with no extra points. */
export function smoothClosedPath(points: Point[]): string {
  const n = points.length;
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const fmt = ([x, y]: Point) => `${Math.round(x)} ${Math.round(y)}`;
  let d = `M${fmt(mid(points[n - 1]!, points[0]!))}`;
  for (let i = 0; i < n; i++) {
    const point = points[i]!;
    d += `Q${fmt(point)} ${fmt(mid(point, points[(i + 1) % n]!))}`;
  }
  return d + 'Z';
}

export function renderTexture(spec: TextureSpec): string {
  const noise = createNoise2D(mulberry32(spec.seed));
  // Pad the grid so the edges d3-contour closes polygons along fall outside the visible area.
  const pad = 4;
  const cols = spec.cells + pad * 2;
  const rows = Math.round((spec.cells * spec.height) / spec.width) + pad * 2;
  const cell = spec.width / spec.cells;
  const values = new Float64Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let amplitude = 1;
      let frequency = spec.frequency;
      let value = 0;
      for (let octave = 0; octave < 4; octave++) {
        value += amplitude * noise(x * frequency, y * frequency);
        amplitude *= 0.5;
        frequency *= 2;
      }
      values[y * cols + x] = value;
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const step = (max - min) / (spec.levels + 1);
  const thresholds = Array.from({ length: spec.levels }, (_, i) => min + step * (i + 1));
  const layers = contours().size([cols, rows]).thresholds(thresholds)(Array.from(values));

  const minor: string[] = [];
  const index: string[] = [];
  layers.forEach((layer, level) => {
    for (const polygon of layer.coordinates) {
      for (const ring of polygon) {
        const scaled = ring.map((p): Point => [(p[0]! - pad) * cell, (p[1]! - pad) * cell]);
        const simplified = simplifyLine(chaikin(scaled.slice(0, -1), 1), cell * spec.tolerance);
        if (simplified.length < 4) continue;
        const d = smoothClosedPath(simplified);
        ((level + 1) % 5 === 0 ? index : minor).push(d);
      }
    }
  });

  // A mask image: only the alpha matters. The page tints it with a theme colour at low strength.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" preserveAspectRatio="xMidYMid slice" fill="none" stroke="#000" stroke-linejoin="round">
<path stroke-opacity="${spec.minorWeight}" stroke-width="1" vector-effect="non-scaling-stroke" d="${minor.join('')}"/>
<path stroke-width="1.6" vector-effect="non-scaling-stroke" d="${index.join('')}"/>
</svg>`;
  // Coordinates are already integers; the default precision keeps the stroke opacity intact.
  return optimize(svg, { multipass: true }).data;
}

export const TEXTURES: TextureSpec[] = [
  {
    name: 'contours-hero',
    width: 1600,
    height: 1000,
    seed: 2003,
    cells: 84,
    levels: 17,
    frequency: 0.022,
    minorWeight: 0.56,
    tolerance: 0.4,
  },
  {
    name: 'contours-band',
    width: 1600,
    height: 700,
    seed: 4452,
    cells: 84,
    levels: 14,
    frequency: 0.026,
    minorWeight: 0.56,
    tolerance: 0.4,
  },
  {
    name: 'contours-ink',
    width: 1600,
    height: 700,
    seed: 4434,
    cells: 84,
    levels: 14,
    frequency: 0.024,
    minorWeight: 0.56,
    tolerance: 0.4,
  },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.join(ROOT, 'public/textures');
  await mkdir(dir, { recursive: true });
  for (const spec of TEXTURES) {
    const svg = renderTexture(spec);
    await writeFile(path.join(dir, `${spec.name}.svg`), svg);
    console.error(`[design] public/textures/${spec.name}.svg ${(svg.length / 1024).toFixed(1)} KB`);
  }
}
