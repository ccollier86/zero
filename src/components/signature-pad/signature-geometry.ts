/**
 * signature-geometry.ts
 *
 * Owns the filled ink outline shared by interactive SVG rendering and export.
 * Adapted from MIT-licensed ReUI Signature Pad (see THIRD_PARTY_NOTICES.md).
 * It consumes validated ink only; it has no DOM, React, or persistence behavior.
 */

import type { SignaturePadBounds, SignaturePadPoint, SignaturePadStroke } from './signature-pad.types';
import { validateSignaturePadStrokes } from './signature-model';

const round = (value: number) => Math.round(value * 100) / 100;
const pair = (x: number, y: number) => `${round(x)} ${round(y)}`;
const radiusAt = (size: number) => Math.max(size / 2, 0.25);
// Beyond ~100 degrees the tangent flips; split the outline with round caps.
const CORNER_COS = -0.17;

function circlePath(x: number, y: number, radius: number): string {
  const r = round(radius);
  return `M${pair(x - r, y)}a${r} ${r} 0 1 0 ${round(r * 2)} 0a${r} ${r} 0 1 0 ${round(-r * 2)} 0Z`;
}

function outlinePath(points: readonly SignaturePadPoint[], from: number, to: number): string {
  const [startX, startY, startSize] = points[from];
  if (from === to) return circlePath(startX, startY, radiusAt(startSize));
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  let nx = 0;
  let ny = 1;
  for (let index = from; index <= to; index++) {
    const [ax, ay] = points[Math.max(index - 1, from)];
    const [bx, by] = points[Math.min(index + 1, to)];
    const length = Math.hypot(bx - ax, by - ay);
    if (length > 1e-6) {
      nx = -(by - ay) / length;
      ny = (bx - ax) / length;
    }
    const [x, y, size] = points[index];
    const r = radiusAt(size);
    left.push([x + nx * r, y + ny * r]);
    right.push([x - nx * r, y - ny * r]);
  }
  const last = left.length - 1;
  const endRadius = round(radiusAt(points[to][2]));
  const startRadius = round(radiusAt(startSize));
  let d = `M${pair(...left[0])}`;
  for (let index = 1; index < last; index++) {
    const [x, y] = left[index];
    d += `Q${pair(x, y)} ${pair((x + left[index + 1][0]) / 2, (y + left[index + 1][1]) / 2)}`;
  }
  d += `L${pair(...left[last])}A${endRadius} ${endRadius} 0 0 0 ${pair(...right[last])}`;
  for (let index = last - 1; index > 0; index--) {
    const [x, y] = right[index];
    d += `Q${pair(x, y)} ${pair((x + right[index - 1][0]) / 2, (y + right[index - 1][1]) / 2)}`;
  }
  return `${d}L${pair(...right[0])}A${startRadius} ${startRadius} 0 0 0 ${pair(...left[0])}Z`;
}

function isCorner(a: SignaturePadPoint, b: SignaturePadPoint, c: SignaturePadPoint): boolean {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return lengths > 0 && (ux * vx + uy * vy) / lengths < CORNER_COS;
}

/** Return one stroke's filled outline with round caps and nonzero winding. */
export function getSignaturePadStrokePath(stroke: SignaturePadStroke): string {
  validateSignaturePadStrokes([stroke]);
  const { points } = stroke;
  if (!points.length) return '';
  let d = '';
  let start = 0;
  for (let index = 1; index < points.length - 1; index++) {
    if (isCorner(points[index - 1], points[index], points[index + 1])) {
      d += outlinePath(points, start, index);
      start = index;
    }
  }
  return d + outlinePath(points, start, points.length - 1);
}

/** Include rendered stroke radii in bounds; empty strokes return null. */
export function getSignaturePadBounds(strokes: readonly SignaturePadStroke[]): SignaturePadBounds | null {
  validateSignaturePadStrokes(strokes);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const [x, y, size] of stroke.points) {
      const r = radiusAt(size);
      minX = Math.min(minX, x - r);
      minY = Math.min(minY, y - r);
      maxX = Math.max(maxX, x + r);
      maxY = Math.max(maxY, y + r);
    }
  }
  return minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
