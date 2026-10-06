/**
 * signature-export.ts
 *
 * Owns bounded standalone SVG framing and serialization from immutable ink.
 * Adapted from MIT-licensed ReUI Signature Pad (see THIRD_PARTY_NOTICES.md).
 * All exports are SSR-safe; this module does not allocate canvases or persist ink.
 */

import type { SignaturePadBounds, SignaturePadExportOptions, SignaturePadFormat, SignaturePadStroke } from './signature-pad.types';
import { getSignaturePadBounds, getSignaturePadStrokePath } from './signature-geometry';
import { assertSignaturePadColor, hasSignaturePadInk, SIGNATURE_PAD_LIMITS, snapshotSignaturePadStrokes } from './signature-model';

function validateOptions(options: SignaturePadExportOptions): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Signature export options require an object.');
  for (const value of [options.width, options.height]) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > SIGNATURE_PAD_LIMITS.exportDimension)) {
      throw new RangeError('Signature export dimensions must be finite, positive, and bounded.');
    }
  }
  if (options.padding !== undefined && (!Number.isFinite(options.padding) || options.padding < 0 || options.padding > SIGNATURE_PAD_LIMITS.padding)) {
    throw new RangeError('Signature export padding must be finite and between 0 and 4,096.');
  }
  if (options.crop !== undefined && typeof options.crop !== 'boolean') throw new TypeError('Signature crop must be a boolean.');
  if (options.color !== undefined) assertSignaturePadColor(options.color);
  if (options.background !== undefined) assertSignaturePadColor(options.background);
}

/** Resolve a fixed origin frame or an outward-rounded crop; validates all inputs. */
export function resolveSignaturePadFrame(
  strokes: readonly SignaturePadStroke[], options: SignaturePadExportOptions = {},
): SignaturePadBounds {
  validateOptions(options);
  const bounds = getSignaturePadBounds(strokes);
  const { width, height, padding = 8, crop = true } = options;
  if (width !== undefined && height !== undefined) return { x: 0, y: 0, width, height };
  if (!bounds) return { x: 0, y: 0, width: width ?? 1, height: height ?? 1 };
  let frame: SignaturePadBounds;
  if (!crop) {
    frame = {
      x: 0, y: 0,
      width: width ?? Math.max(1, Math.ceil(bounds.x + bounds.width + padding)),
      height: height ?? Math.max(1, Math.ceil(bounds.y + bounds.height + padding)),
    };
  } else {
    const x = Math.floor(bounds.x - padding);
    const y = Math.floor(bounds.y - padding);
    frame = {
      x, y,
      width: Math.ceil(bounds.x + bounds.width + padding) - x,
      height: Math.ceil(bounds.y + bounds.height + padding) - y,
    };
  }
  if (frame.width > SIGNATURE_PAD_LIMITS.exportDimension || frame.height > SIGNATURE_PAD_LIMITS.exportDimension) {
    throw new RangeError('Signature ink exceeds the supported export frame.');
  }
  return frame;
}

const escapeAttribute = (value: string) => value.replace(/[&"<>]/g, (char) => `&#${char.charCodeAt(0)};`);

/** Build a safe SVG document; omitted ink colors export black, not theme-dependent. */
export function signaturePadToSVG(strokes: readonly SignaturePadStroke[], options: SignaturePadExportOptions = {}): string {
  const ink = snapshotSignaturePadStrokes(strokes);
  const { x, y, width, height } = resolveSignaturePadFrame(ink, options);
  const color = options.color ?? '#000000';
  const background = options.background === undefined ? ''
    : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeAttribute(options.background)}"/>`;
  const paths = ink.map((stroke) => {
    const d = getSignaturePadStrokePath(stroke);
    return d ? `<path d="${d}" fill="${escapeAttribute(stroke.color ?? color)}"/>` : '';
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}">${background}${paths}</svg>`;
}

/** Serialize SVG as a data URL or JSON as canonical ink; truly empty ink is ''. */
export function serializeSignaturePad(
  strokes: readonly SignaturePadStroke[], format: SignaturePadFormat = 'svg', options: SignaturePadExportOptions = {},
): string {
  if (format !== 'svg' && format !== 'json') throw new TypeError('Signature format must be svg or json.');
  validateOptions(options);
  const ink = snapshotSignaturePadStrokes(strokes);
  if (!hasSignaturePadInk(ink)) return '';
  if (format === 'json') return JSON.stringify(ink);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(signaturePadToSVG(ink, options))}`;
}

/** SVG-only data URL; SSR-safe and empty-string preserving for required fields. */
export function signaturePadToDataURL(strokes: readonly SignaturePadStroke[], options: SignaturePadExportOptions = {}): string {
  return serializeSignaturePad(strokes, 'svg', options);
}

/** SVG upload Blob without base64 inflation; empty ink returns null. */
export async function signaturePadToBlob(
  strokes: readonly SignaturePadStroke[], options: SignaturePadExportOptions = {},
): Promise<Blob | null> {
  validateOptions(options);
  const ink = snapshotSignaturePadStrokes(strokes);
  return hasSignaturePadInk(ink) ? new Blob([signaturePadToSVG(ink, options)], { type: 'image/svg+xml' }) : null;
}
