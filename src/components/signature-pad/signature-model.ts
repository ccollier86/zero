/**
 * signature-model.ts
 *
 * Owns bounded ink admission, immutable snapshots, and undo/redo transitions.
 * It consumes only signature contracts, never React, persistence, or logging.
 */

import type { SignaturePadHistory, SignaturePadPoint, SignaturePadStroke } from './signature-pad.types';

/** Admission limits bound imported JSON and live drawing without allocating images. */
export const SIGNATURE_PAD_LIMITS = Object.freeze({
  strokes: 1_000, points: 100_000, coordinate: 1_000_000, diameter: 256,
  exportDimension: 2_001_024, padding: 4_096,
});

/** A history retains the latest 100 committed changes, including clear. */
export const SIGNATURE_PAD_HISTORY_LIMIT = 100;

/**
 * Accept a bounded solid CSS color, not URL paints, variables, or injected SVG.
 * Named colors, hex, and numeric rgb/hsl functions remain theme-independent.
 */
export function assertSignaturePadColor(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 128 || !(
    /^[a-z]+$/i.test(value)
    || /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
    || /^(?:rgba?|hsla?)\((?:[-+]?(?:\d+\.?\d*|\.\d+)(?:deg|rad|grad|turn|%)?[\s,/]*)+\)$/i.test(value)
  )) throw new TypeError('Signature ink and background require a bounded solid CSS color.');
}

/** Validate imported ink before rendering/export, without trusting TypeScript alone. */
export function validateSignaturePadStrokes(value: unknown): asserts value is readonly SignaturePadStroke[] {
  if (!Array.isArray(value) || value.length > SIGNATURE_PAD_LIMITS.strokes) {
    throw new RangeError('Signature requires an array of at most 1,000 strokes.');
  }
  let count = 0;
  for (const stroke of value) {
    if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke) || !Array.isArray(stroke.points)) {
      throw new TypeError('Each signature stroke requires a point array.');
    }
    count += stroke.points.length;
    if (count > SIGNATURE_PAD_LIMITS.points) throw new RangeError('Signature exceeds 100,000 points.');
    if (stroke.color !== undefined) assertSignaturePadColor(stroke.color);
    for (const point of stroke.points) {
      if (!Array.isArray(point) || point.length !== 3
        || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !Number.isFinite(point[2])) {
        throw new TypeError('Signature points require finite x, y, and ink diameter numbers.');
      }
      if (Math.abs(point[0]) > SIGNATURE_PAD_LIMITS.coordinate
        || Math.abs(point[1]) > SIGNATURE_PAD_LIMITS.coordinate
        || point[2] <= 0 || point[2] > SIGNATURE_PAD_LIMITS.diameter) {
        throw new RangeError('Signature coordinates or positive ink diameter exceed supported bounds.');
      }
    }
  }
}

// Only snapshots created here may be shared; an arbitrary frozen wrapper can
// still contain mutable points. Weak ownership does not retain retired history.
const canonicalStrokes = new WeakSet<SignaturePadStroke>();
const canonicalValues = new WeakSet<readonly SignaturePadStroke[]>();

/** Snapshot canonical ink deeply; returned points never alias caller-owned data. */
export function snapshotSignaturePadStrokes(strokes: readonly SignaturePadStroke[]): readonly SignaturePadStroke[] {
  validateSignaturePadStrokes(strokes);
  if (canonicalValues.has(strokes)) return strokes;
  const snapshot = Object.freeze(strokes.map((stroke) => {
    if (canonicalStrokes.has(stroke)) return stroke;
    const immutable = Object.freeze({
      points: Object.freeze(stroke.points.map(([x, y, size]) => Object.freeze([x, y, size]) as SignaturePadPoint)),
      ...(stroke.color === undefined ? {} : { color: stroke.color }),
    });
    canonicalStrokes.add(immutable);
    return immutable;
  }));
  canonicalValues.add(snapshot);
  return snapshot;
}

/** Empty point arrays are not signatures and must not satisfy a required field. */
export function hasSignaturePadInk(strokes: readonly SignaturePadStroke[]): boolean {
  validateSignaturePadStrokes(strokes);
  return strokes.some((stroke) => stroke.points.length > 0);
}

/** Compare every point and color; equal controlled deep copies preserve history. */
export function sameSignaturePadStrokes(left: readonly SignaturePadStroke[], right: readonly SignaturePadStroke[]): boolean {
  if (left === right) return true;
  return left.length === right.length && left.every((stroke, index) => {
    const other = right[index];
    return stroke.color === other.color && stroke.points.length === other.points.length
      && stroke.points.every((point, pointIndex) => point.every((value, coordinate) => value === other.points[pointIndex][coordinate]));
  });
}

const EMPTY_HISTORY = Object.freeze([]) as readonly (readonly SignaturePadStroke[])[];

function history(
  present: readonly SignaturePadStroke[],
  past: readonly (readonly SignaturePadStroke[])[] = EMPTY_HISTORY,
  future: readonly (readonly SignaturePadStroke[])[] = EMPTY_HISTORY,
): SignaturePadHistory {
  return Object.freeze({ present, past: Object.freeze([...past]), future: Object.freeze([...future]) });
}

/** Create history from a copied default/current value, with no undoable changes. */
export function createSignaturePadHistory(strokes: readonly SignaturePadStroke[] = []): SignaturePadHistory {
  return history(snapshotSignaturePadStrokes(strokes));
}

/** An outside edit discards undo/redo; an equal deep copy preserves both stacks. */
export function reconcileSignaturePadHistory(current: SignaturePadHistory, strokes: readonly SignaturePadStroke[]): SignaturePadHistory {
  validateSignaturePadStrokes(strokes);
  return sameSignaturePadStrokes(current.present, strokes) ? current : createSignaturePadHistory(strokes);
}

/** Record a distinct new value, bound history depth, and invalidate prior redo. */
export function commitSignaturePadHistory(current: SignaturePadHistory, strokes: readonly SignaturePadStroke[]): SignaturePadHistory {
  const next = snapshotSignaturePadStrokes(strokes);
  if (sameSignaturePadStrokes(current.present, next)) return current;
  return history(next, [...current.past, current.present].slice(-SIGNATURE_PAD_HISTORY_LIMIT));
}

/** Restore the previous snapshot; an empty past is an intentional no-op. */
export function undoSignaturePadHistory(current: SignaturePadHistory): SignaturePadHistory {
  const previous = current.past.at(-1);
  return previous ? history(previous, current.past.slice(0, -1), [current.present, ...current.future]) : current;
}

/** Restore the next snapshot; an empty future is an intentional no-op. */
export function redoSignaturePadHistory(current: SignaturePadHistory): SignaturePadHistory {
  const next = current.future[0];
  return next ? history(next, [...current.past, current.present].slice(-SIGNATURE_PAD_HISTORY_LIMIT), current.future.slice(1)) : current;
}

/** Form reset restores the immutable default and clears history, like a native field. */
export function resetSignaturePadHistory(strokes: readonly SignaturePadStroke[]): SignaturePadHistory {
  return createSignaturePadHistory(strokes);
}
