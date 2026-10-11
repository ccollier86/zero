'use client';

/** Radix retains the actual viewport and axis registration; shared native rails/fades do not create another scroller or focus region. */
import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "#zero/lib/utils"
import { composeOverlayRefs } from '../overlays/overlay-scope'
import { ScrollViewportDecoration } from '../overlays/scroll-viewport-decoration'
import type { ScrollViewportOrientation } from '../overlays/scroll-viewport-metrics'

type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /** Axes with native scrolling; vertical preserves the existing default. */
  orientation?: ScrollViewportOrientation
  /** Conditional content-only edge fades; rails remain outside the mask. */
  fadeEdges?: boolean
  /** Access the actual native viewport without changing the Root ref contract. */
  viewportRef?: React.Ref<HTMLDivElement>
}

function ScrollArea({
  className,
  children,
  orientation = 'vertical',
  fadeEdges = true,
  viewportRef,
  type = 'hover',
  scrollHideDelay,
  style,
  ...props
}: ScrollAreaProps) {
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null)
  const ref = React.useMemo(() => composeOverlayRefs<HTMLDivElement>(setViewport, viewportRef), [viewportRef])
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative overflow-hidden", className)}
      type={type}
      scrollHideDelay={scrollHideDelay ?? 900}
      style={{ ...(scrollHideDelay === undefined ? {} : { '--zero-scroll-hide-delay': `${scrollHideDelay}ms` }), ...style } as React.CSSProperties}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport ref={ref} className="size-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      {/* Registration keeps Radix's Viewport axes enabled. Its 18px native-thumb geometry must not drive a painted 28px Arc thumb. */}
      {orientation !== 'horizontal' && <ScrollAreaPrimitive.Scrollbar orientation="vertical" data-zero-scroll-registration=""
        aria-hidden="true" style={{ display: 'none', visibility: 'hidden', pointerEvents: 'none' }} />}
      {orientation !== 'vertical' && <ScrollAreaPrimitive.Scrollbar orientation="horizontal" data-zero-scroll-registration=""
        aria-hidden="true" style={{ display: 'none', visibility: 'hidden', pointerEvents: 'none' }} />}
      <ScrollViewportDecoration viewport={viewport} orientation={orientation} fadeEdges={fadeEdges}
        scrollbars={type === 'always' || type === 'auto' ? 'always' : type === 'scroll' ? 'scroll' : 'hover'} />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-bar"
      orientation={orientation}
      className={cn(
        "zero-scroll-radix-bar flex touch-none select-none transition-colors",
        orientation === "vertical" &&
          "h-full",
        orientation === "horizontal" &&
          "flex-col",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className="zero-scroll-radix-thumb relative flex-1" />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar, type ScrollAreaProps }
