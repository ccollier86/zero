/**
 * signature-pad.types.ts
 *
 * Owns the immutable signature ink, history, and export contracts. These types
 * have no React, transport, persistence, or legal-verification dependencies.
 */

/** CSS-pixel coordinates from the area's origin and positive ink diameter. */
export type SignaturePadPoint = readonly [x: number, y: number, size: number];

/** Recorded ink; omitted color follows the pad's current text color. */
export interface SignaturePadStroke {
  readonly points: readonly SignaturePadPoint[];
  readonly color?: string;
}

/** Supported browser pointer kinds for signature input. */
export type SignaturePadPointerType = 'mouse' | 'pen' | 'touch';

/** Auto uses pen pressure and mouse/touch velocity for ink sizing. */
export type SignaturePadSizing = 'auto' | 'pressure' | 'velocity';

/** SVG serializes to an image data URL; JSON carries the immutable ink model. */
export type SignaturePadFormat = 'svg' | 'json';

/** Bounded SVG framing and solid colors; rasterization is not part of this API. */
export interface SignaturePadExportOptions {
  /** Both values together fix a frame at the area's origin. */
  width?: number;
  height?: number;
  /** Space around cropped ink, in CSS pixels. Defaults to 8. */
  padding?: number;
  /** False keeps the area's origin rather than cropping to the ink. */
  crop?: boolean;
  /** Fallback ink color for strokes without their own color. Defaults to black. */
  color?: string;
  /** Optional solid background; omitted preserves transparency. */
  background?: string;
}

/** Ink bounds include each point's rendered radius. */
export interface SignaturePadBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Immutable history snapshots used by the component's interaction controller. */
export interface SignaturePadHistory {
  readonly past: readonly (readonly SignaturePadStroke[])[];
  readonly present: readonly SignaturePadStroke[];
  readonly future: readonly (readonly SignaturePadStroke[])[];
}

/** Latest signature state and explicit user actions; nothing is persisted here. */
export interface SignaturePadApi {
  readonly strokes: readonly SignaturePadStroke[];
  readonly isEmpty: boolean;
  readonly isDrawing: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  clear(): void;
  undo(): void;
  redo(): void;
  /** Restore the initial form value and clear undo/redo history. */
  reset(): void;
  focus(): void;
  toSVG(options?: SignaturePadExportOptions): string;
  /** SVG data URL, including on the server; no canvas is allocated. */
  toDataURL(options?: SignaturePadExportOptions): string;
  /** SVG Blob, or null when there is no ink. */
  toBlob(options?: SignaturePadExportOptions): Promise<Blob | null>;
  serialize(format?: SignaturePadFormat, options?: SignaturePadExportOptions): string;
}
