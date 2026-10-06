'use client';

/**
 * SVG pointer drawing adapted from MIT ReUI ef0fe125 (see THIRD_PARTY_NOTICES).
 * Owns coalesced input, pressure/velocity ink and live painting only. The shared
 * controller owns history/guarded actions; native form binding is separate.
 */
import { memo, useEffect, useLayoutEffect, useId, useRef } from 'react';
import type { ComponentProps, PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '../../lib/utils';
import { useSignaturePad, useSignaturePadConfig } from './signature-pad-context';
import { getSignaturePadStrokePath } from './signature-geometry';
import { SIGNATURE_PAD_LIMITS } from './signature-model';
import type { SignaturePadStroke, SignaturePadPoint, SignaturePadPointerType } from './signature-pad.types';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const round = (value: number) => Math.round(value * 100) / 100;
const AREA_BASE_CLASS = 'relative h-44 w-full overflow-hidden border text-foreground outline-none touch-none select-none [-webkit-touch-callout:none] cursor-crosshair data-disabled:cursor-not-allowed data-disabled:opacity-50 data-readonly:cursor-default';
const AREA_STATE_CLASS = 'rounded-xl transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20';
const AREA_VARIANT_CLASS = { default: 'border-input bg-background shadow-xs', muted: 'border-border bg-muted/50', ghost: 'border-transparent bg-transparent' };

type LiveStroke = {
  pointerId: number
  pointerType: SignaturePadPointerType
  pointLimit: number
  points: SignaturePadPoint[]
  left: number
  top: number
  scaleX: number
  scaleY: number
  time: number
  velocity: number
  size: number
  /* The unsmoothed last position. Streamline trails the pointer, so without
     it a stroke lifted in motion ended short (12px on a fast 200px line). */
  rawX: number
  rawY: number
}

const StrokePath = memo(function StrokePath({
  stroke,
}: {
  stroke: SignaturePadStroke
}) {
  return (
    <path
      data-slot="signature-pad-stroke"
      d={getSignaturePadStrokePath(stroke)}
      fill={stroke.color ?? "currentColor"}
    />
  )
})

export type SignaturePadAreaProps = ComponentProps<"div"> & {
  /** `muted` is a filled surface; `ghost` drops the chrome for a card or document that has its own. */
  variant?: keyof typeof AREA_VARIANT_CLASS
}

/**
 * The drawing surface. Children are overlays (a guide, a placeholder, pinned
 * controls) and must be `pointer-events-none` unless they are controls: a
 * stroke only starts on the area itself, never on something inside it.
 */
export function SignaturePadArea({
  ref,
  variant = "default",
  className,
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
  onContextMenu,
  "aria-describedby": describedBy,
  ...props
}: SignaturePadAreaProps) {
  const api = useSignaturePad()
  const config = useSignaturePadConfig("SignaturePadArea")
  const liveRef = useRef<LiveStroke | null>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const frameRef = useRef(0)

  const previousEpoch = useRef(config.epoch)
  useIsoLayoutEffect(() => {
    if (previousEpoch.current !== config.epoch || !config.interactive) {
      liveRef.current = null
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      pathRef.current?.setAttribute("d", "")
      config.setDrawing(false)
    }
    previousEpoch.current = config.epoch
  }, [config.epoch, config.interactive, config.color, config.minWidth, config.maxWidth, config.smoothing, config.sizing])
  useEffect(() => () => { liveRef.current = null; cancelAnimationFrame(frameRef.current) }, [])

  const paint = () => {
    frameRef.current = 0
    const live = liveRef.current
    pathRef.current?.setAttribute(
      "d",
      live ? getSignaturePadStrokePath({ points: live.points }) : ""
    )
  }

  const schedulePaint = () => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(paint)
  }

  const addSample = (
    live: LiveStroke,
    clientX: number,
    clientY: number,
    pressure: number,
    time: number
  ) => {
    const x = (clientX - live.left) * live.scaleX
    const y = (clientY - live.top) * live.scaleY
    if (![x, y, pressure, time].every(Number.isFinite) ||
      Math.abs(x) > SIGNATURE_PAD_LIMITS.coordinate || Math.abs(y) > SIGNATURE_PAD_LIMITS.coordinate ||
      live.points.length >= live.pointLimit) return
    live.rawX = x
    live.rawY = y
    const { minWidth, maxWidth, sizing, smoothing } = config
    const usePressure =
      sizing === "pressure" || (sizing === "auto" && live.pointerType === "pen")
    const pressed = minWidth + (maxWidth - minWidth) * Math.min(Math.max(pressure, 0), 1)
    const previous = live.points[live.points.length - 1]

    if (!previous) {
      /* A pen at rest is slow, so it starts near full width; at the midpoint
         a tap left a dot a third the weight of the line beside it. */
      live.size = usePressure ? pressed : minWidth + (maxWidth - minWidth) * 0.8
      live.time = time
      live.points.push([round(x), round(y), Math.max(Number.EPSILON, live.size)])
      return
    }

    /* Streamline: each point moves only part of the way toward the pointer. */
    const follow = 1 - smoothing * 0.85
    const sx = previous[0] + (x - previous[0]) * follow
    const sy = previous[1] + (y - previous[1]) * follow
    const distance = Math.hypot(sx - previous[0], sy - previous[1])
    if (distance < 0.75) return

    const speed = distance / Math.max(time - live.time, 1)
    live.velocity = live.velocity * 0.3 + speed * 0.7
    live.time = time
    const target = usePressure
      ? pressed
      : Math.max(maxWidth / (live.velocity + 1), minWidth)
    live.size += (target - live.size) * 0.35
    live.points.push([round(sx), round(sy), Math.max(Number.EPSILON, live.size)])
  }

  /** `commit: false` discards: a pointercancel is the platform taking the pointer back, often a rejected palm. */
  const finish = (pointerId: number, commit = true) => {
    const live = liveRef.current
    if (!live || live.pointerId !== pointerId) return
    liveRef.current = null
    cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
    /* Cleared in the same discrete event that commits the stroke, so React
       paints the committed path in this frame and the ink never blinks. */
    pathRef.current?.setAttribute("d", "")
    config.setDrawing(false)
    if (!commit) return
    const last = live.points[live.points.length - 1]
    if (!last) return
    if (last && live.points.length < live.pointLimit && Math.hypot(live.rawX - last[0], live.rawY - last[1]) >= 0.5) {
      live.points.push([round(live.rawX), round(live.rawY), Math.max(Number.EPSILON, live.size)])
    }
    config.commitStroke(
      config.color === undefined
        ? { points: live.points }
        : { points: live.points, color: config.color }
    )
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerDown?.(event)
    const area = event.currentTarget
    const pointerType = event.pointerType as SignaturePadPointerType
    if (
      event.defaultPrevented ||
      !config.interactive ||
      event.target !== area ||
      !event.isPrimary ||
      api.strokes.length >= SIGNATURE_PAD_LIMITS.strokes ||
      api.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) >= SIGNATURE_PAD_LIMITS.points ||
      !["mouse", "pen", "touch"].includes(pointerType) ||
      ![event.clientX, event.clientY, event.pressure, event.timeStamp].every(Number.isFinite) ||
      event.button !== 0 ||
      (config.pointerTypes && !config.pointerTypes.includes(pointerType))
    ) {
      return
    }

    /* A pen landing mid-stroke means the touch stroke was a resting palm. */
    const live = liveRef.current
    if (live) {
      if (live.pointerType !== "touch" || pointerType !== "pen") return
      liveRef.current = null
    }

    /* No preventDefault: the native mousedown focuses the area without
       `:focus-visible`, where a scripted focus() lit the keyboard ring on
       every mouse stroke. Touch scrolling and text selection are already off
       through `touch-none` and `select-none`. */
    try {
      area.setPointerCapture(event.pointerId)
    } catch {
      /* Only a pointer that is no longer active refuses capture. */
    }

    const rect = area.getBoundingClientRect()
    const next: LiveStroke = {
      pointerId: event.pointerId,
      pointerType,
      pointLimit: SIGNATURE_PAD_LIMITS.points - api.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0),
      points: [],
      /* The ink layer starts inside the border, and a transformed ancestor
         (a zooming dialog) scales the rect but not the coordinate space. */
      left: rect.left + area.clientLeft * (rect.width / area.offsetWidth || 1),
      top: rect.top + area.clientTop * (rect.height / area.offsetHeight || 1),
      scaleX: rect.width ? area.offsetWidth / rect.width : 1,
      scaleY: rect.height ? area.offsetHeight / rect.height : 1,
      time: event.timeStamp,
      velocity: 0,
      size: 0,
      rawX: 0,
      rawY: 0,
    }
    liveRef.current = next
    addSample(
      next,
      event.clientX,
      event.clientY,
      event.pressure,
      event.timeStamp
    )
    schedulePaint()
    config.setDrawing(true)
    if (!config.notifyStrokeStart({ pointerType })) finish(event.pointerId, false)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event)
    const live = liveRef.current
    if (!config.interactive || event.defaultPrevented || !live || live.pointerId !== event.pointerId) return
    /* A fast pen reports several samples per frame; the coalesced list keeps
       curves round instead of cutting across them. */
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? []
    for (const sample of samples.length ? samples : [event.nativeEvent]) {
      addSample(
        live,
        sample.clientX,
        sample.clientY,
        sample.pressure,
        sample.timeStamp
      )
    }
    schedulePaint()
  }

  const labelled = props["aria-label"] ?? props["aria-labelledby"]
  const statusId = useId()

  return (
    <div
      ref={(node) => {
        config.setArea(node)
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      role="application"
      aria-roledescription="signature pad"
      aria-label={labelled ? undefined : "Signature pad"}
      aria-disabled={api.disabled || undefined}
      aria-invalid={config.invalid || props["aria-invalid"] || undefined}
      aria-describedby={[describedBy, statusId, config.invalid ? config.errorId : undefined].filter(Boolean).join(" ")}
      tabIndex={config.interactive ? 0 : -1}
      data-slot="signature-pad-area"
      data-variant={variant}
      data-empty={api.isEmpty || undefined}
      data-drawing={api.isDrawing || undefined}
      data-disabled={api.disabled || undefined}
      data-readonly={api.readOnly || undefined}
      className={cn(
        AREA_BASE_CLASS,
        AREA_STATE_CLASS,
        AREA_VARIANT_CLASS[variant],
        className
      )}
      {...props}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => {
        onPointerUp?.(event)
        finish(event.pointerId)
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event)
        finish(event.pointerId, false)
      }}
      onLostPointerCapture={(event) => {
        onLostPointerCapture?.(event)
        finish(event.pointerId, false)
      }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        onContextMenu?.(event)
        /* A long press on touch opens the context menu mid-stroke. */
        if (liveRef.current) event.preventDefault()
      }}
    >
      {children}
      {/* The ink is invisible to assistive tech, so its state is spoken here. */}
      <span id={statusId} className="sr-only">
        {api.isEmpty ? "Empty" : "Signed"}
        {api.readOnly ? ", read only" : ""}
      </span>
      <svg
        data-slot="signature-pad-canvas"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        {api.strokes.map((stroke, index) => (
          <StrokePath key={index} stroke={stroke} />
        ))}
        <path ref={pathRef} fill={config.color ?? "currentColor"} />
      </svg>

    </div>
  )
}
