/**
 * floating-button-group-geometry.ts
 *
 * Owns pure tray-relative decorative measurements. The browser adapter supplies
 * owner-document rectangles and computed transforms; this module never reads
 * DOM globals or moves native controls. Unsupported transforms retire paint
 * instead of breaking focus or commands.
 */

/** Screen-space rectangles from the same owner document and measurement pass. */
export interface FloatingButtonGroupRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Native tray measurements needed to recover padding-box CSS coordinates. */
export interface FloatingButtonGroupMeasurement {
  ownerRect: FloatingButtonGroupRect;
  targetRect: FloatingButtonGroupRect;
  ownerOffsetWidth: number;
  ownerOffsetHeight: number;
  ownerClientLeft: number;
  ownerClientTop: number;
  scrollLeft: number;
  scrollTop: number;
  devicePixelRatio: number;
  /** All computed transforms affecting owner and target, including ancestors. */
  transforms?: readonly string[];
}

/** Padding-box coordinates for a stationary target's independent highlight. */
export interface FloatingButtonGroupGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MATRIX_EPSILON = 1e-8;
const nearZero = (value: number): boolean => Math.abs(value) < MATRIX_EPSILON;
const nearOne = (value: number): boolean => Math.abs(value - 1) < MATRIX_EPSILON;

/**
 * Admit positive per-axis scale/translation only. Computed CSS matrices with
 * rotation, skew, reflection or perspective cannot be recovered from bounds.
 */
export function isFloatingButtonGroupAxisAlignedTransform(transform: string): boolean {
  const input = transform.trim();
  if (!input || input === 'none') return true;
  const match = /^(matrix|matrix3d)\(([^)]+)\)$/u.exec(input);
  if (!match) return false;
  const coefficients = match[2]?.split(',').map(value => value.trim()) ?? [];
  if (coefficients.some(value => !value)) return false;
  const values = coefficients.map(Number);
  if (!values.every(Number.isFinite)) return false;
  if (match[1] === 'matrix') {
    return values.length === 6 && (values[0] ?? 0) > 0 && (values[3] ?? 0) > 0
      && nearZero(values[1] ?? NaN) && nearZero(values[2] ?? NaN);
  }
  if (values.length !== 16 || (values[0] ?? 0) <= 0 || (values[5] ?? 0) <= 0
    || (values[10] ?? 0) <= 0 || !nearOne(values[15] ?? NaN)) return false;
  return [1, 2, 3, 4, 6, 7, 8, 9, 11].every(index => nearZero(values[index] ?? NaN));
}

/**
 * Recover per-axis CSS geometry from transformed border boxes, subtract native
 * borders and restore native scroll coordinates. DPR snapping occurs in screen
 * space, so fractional/nonuniform scale cannot accumulate local rounding drift.
 * Zero-sized/disconnected/invalid or unsupported transformed paint returns null.
 */
export function resolveFloatingButtonGroupGeometry(
  measurement: FloatingButtonGroupMeasurement,
): FloatingButtonGroupGeometry | null {
  const { ownerRect, targetRect, ownerOffsetWidth, ownerOffsetHeight,
    ownerClientLeft, ownerClientTop, scrollLeft, scrollTop } = measurement;
  const values = [ownerRect.left, ownerRect.top, ownerRect.width, ownerRect.height,
    targetRect.left, targetRect.top, targetRect.width, targetRect.height,
    ownerOffsetWidth, ownerOffsetHeight, ownerClientLeft, ownerClientTop, scrollLeft, scrollTop];
  if (!values.every(Number.isFinite) || ownerRect.width <= 0 || ownerRect.height <= 0
    || ownerOffsetWidth <= 0 || ownerOffsetHeight <= 0 || targetRect.width <= 0 || targetRect.height <= 0
    || ownerClientLeft < 0 || ownerClientTop < 0
    || measurement.transforms?.some(transform => !isFloatingButtonGroupAxisAlignedTransform(transform))) return null;
  const scaleX = ownerRect.width / ownerOffsetWidth;
  const scaleY = ownerRect.height / ownerOffsetHeight;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return null;
  const dpr = Number.isFinite(measurement.devicePixelRatio) && measurement.devicePixelRatio > 0
    ? measurement.devicePixelRatio : 1;
  const snap = (value: number): number => Math.round(value * dpr) / dpr;
  const left = snap(targetRect.left), top = snap(targetRect.top);
  const right = snap(targetRect.left + targetRect.width), bottom = snap(targetRect.top + targetRect.height);
  const geometry = {
    x: (left - ownerRect.left) / scaleX - ownerClientLeft + scrollLeft,
    y: (top - ownerRect.top) / scaleY - ownerClientTop + scrollTop,
    width: (right - left) / scaleX,
    height: (bottom - top) / scaleY,
  };
  return Object.values(geometry).every(Number.isFinite) && geometry.width > 0 && geometry.height > 0 ? geometry : null;
}
