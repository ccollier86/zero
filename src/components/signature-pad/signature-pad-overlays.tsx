'use client';

/** Guides, pinned controls and SSR previews adapted from MIT ReUI; no drawing state or persistence. */
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
import { useSignaturePad } from './signature-pad-context';
import { getSignaturePadStrokePath } from './signature-geometry';
import { resolveSignaturePadFrame } from './signature-export';
import { assertSignaturePadColor, hasSignaturePadInk } from './signature-model';
import type { SignaturePadStroke } from './signature-pad.types';

export function SignaturePadGuide({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="signature-pad-guide"
      aria-hidden="true"
      className={cn(
        "text-muted-foreground border-muted-foreground/40 pointer-events-none absolute inset-x-6 bottom-8 flex items-end gap-2 border-b border-dashed pb-1.5 text-xs",
        className
      )}
      {...props}
    >
      {children ?? (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="size-3"
        >
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      )}
    </div>
  )
}

/** Shown only while the pad is empty and nobody is drawing. */
export function SignaturePadPlaceholder({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  const { isEmpty, isDrawing } = useSignaturePad()
  if (!isEmpty || isDrawing) return null

  return (
    <div
      data-slot="signature-pad-placeholder"
      aria-hidden="true"
      className={cn(
        "text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-sm",
        className
      )}
      {...props}
    >
      {children ?? "Sign here"}
    </div>
  )
}

const CONTROLS_POSITION_CLASS = {
  "top-start": "top-2 start-2",
  "top-end": "top-2 end-2",
  "bottom-start": "bottom-2 start-2",
  "bottom-end": "bottom-2 end-2",
}

/**
 * Pins a group of controls to a corner of the area, above the ink. Top-end by
 * default: signatures run along the bottom, where `bottom-end` sat on the
 * guide line and under the last letters.
 */
export function SignaturePadControls({
  position = "top-end",
  className,
  ...props
}: ComponentProps<"div"> & {
  position?: keyof typeof CONTROLS_POSITION_CLASS
}) {
  return (
    <div
      data-slot="signature-pad-controls"
      data-position={position}
      className={cn(
        "absolute z-10 flex items-center gap-1",
        CONTROLS_POSITION_CLASS[position],
        className
      )}
      {...props}
    />
  )
}


export function SignaturePadPreview({
  strokes,
  padding = 4,
  color,
  className,
  ...props
}: Omit<ComponentProps<"svg">, "color"> & {
  strokes: readonly SignaturePadStroke[]
  padding?: number
  color?: string
}) {
  if (color !== undefined) assertSignaturePadColor(color)
  if (!hasSignaturePadInk(strokes)) return null
  const { x, y, width, height } = resolveSignaturePadFrame(strokes, { padding })

  return (
    <svg
      data-slot="signature-pad-preview"
      role="img"
      aria-label="Signature"
      viewBox={`${x} ${y} ${width} ${height}`}
      width={width}
      height={height}
      className={cn("text-foreground h-auto max-w-full", className)}
      {...props}
    >
      {strokes.map((stroke, index) => (
        <path
          key={index}
          d={getSignaturePadStrokePath(stroke)}
          fill={stroke.color ?? color ?? "currentColor"}
        />
      ))}
    </svg>
  )
}
