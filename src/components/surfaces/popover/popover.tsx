import * as React from 'react';

import {
  Popover as PopoverPrimitive,
  PopoverTrigger as PopoverTriggerPrimitive,
  PopoverContent as PopoverContentPrimitive,
  PopoverPortal as PopoverPortalPrimitive,
  PopoverClose as PopoverClosePrimitive,
  usePopover,
  type PopoverProps as PopoverPrimitiveProps,
  type PopoverTriggerProps as PopoverTriggerPrimitiveProps,
  type PopoverContentProps as PopoverContentPrimitiveProps,
  type PopoverCloseProps as PopoverClosePrimitiveProps,
} from './popover-primitive';
import { cn } from '#zero/lib/utils';
import { useOwnedFloatingOverlay, useOverlayTheme, composeOverlayRefs } from '../../_internal/overlay-scope/overlay-scope';
import { projectAnchoredSurfaceTheme } from '../../_internal/anchored-surface/anchored-surface-motion';
import { ScrollViewportDecoration } from '../../_internal/scroll-viewport/scroll-viewport-decoration';
import type { ScrollViewportOrientation } from '../../_internal/scroll-viewport/scroll-viewport-metrics';

type PopoverProps = PopoverPrimitiveProps;

function Popover(props: PopoverProps) {
  return <PopoverPrimitive {...props} />;
}

type PopoverTriggerProps = PopoverTriggerPrimitiveProps;

function PopoverTrigger(props: PopoverTriggerProps) {
  return <PopoverTriggerPrimitive {...props} />;
}

type PopoverContentProps = PopoverContentPrimitiveProps & { portalContainer?: HTMLElement | null };

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  portalContainer,
  ref,
  style,
  ...props
}: PopoverContentProps) {
  const floating = useOwnedFloatingOverlay();
  const { trigger } = usePopover();
  const sourceTheme = useOverlayTheme(trigger);
  const contentRef = React.useMemo(() => composeOverlayRefs(floating.ref, ref), [floating.ref, ref]);
  return (
    <PopoverPortalPrimitive container={portalContainer ?? floating.owner?.container}>
      <PopoverContentPrimitive
        {...floating.contentProps}
        ref={contentRef}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'relative z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border border-border/85 bg-popover p-4 text-popover-foreground font-[family-name:var(--zero-theme-font-body,inherit)] shadow-lg outline-hidden dark:shadow-none',
          className,
        )}
        {...props}
        inert={floating.owner && !floating.owner.active ? true : props.inert}
        style={{ ...projectAnchoredSurfaceTheme(floating.contentProps.style),
          ...(trigger?.isConnected ? projectAnchoredSurfaceTheme(sourceTheme) : {}), ...style,
          ...(floating.owner ? { zIndex: floating.owner.zIndex + 2,
            ...(!floating.owner.active ? { pointerEvents: 'none' as const } : {}) } : {}) }}
      />
    </PopoverPortalPrimitive>
  );
}

/** Opt-in content-only scrolling. Existing picker/cmdk viewports are never automatically wrapped. */
type PopoverViewportProps = React.ComponentProps<'div'> & {
  fadeEdges?: boolean;
  scrollbars?: 'hover' | 'scroll' | 'always' | 'hidden';
  orientation?: ScrollViewportOrientation;
};

/** A plain native body viewport; author header/footer siblings inside the bounded PopoverContent. */
function PopoverViewport({ ref, className, fadeEdges = true, scrollbars = 'hover', orientation = 'vertical', ...props }: PopoverViewportProps) {
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
  const nativeRef = React.useMemo(() => composeOverlayRefs<HTMLDivElement>(setViewport, ref), [ref]);
  return <div data-slot="popover-scroll-frame" className="relative flex min-h-0 flex-1 flex-col">
    <div ref={nativeRef} data-slot="popover-viewport" className={cn('min-h-0 max-h-[min(var(--zero-theme-picker-list-max-height,18.5rem),var(--radix-popover-content-available-height,calc(100dvh-2rem)))] flex-1',
      orientation === 'both' ? 'overflow-auto' : orientation === 'horizontal' ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto overflow-x-hidden', className)} {...props} />
    <ScrollViewportDecoration viewport={viewport} orientation={orientation} fadeEdges={fadeEdges} scrollbars={scrollbars} />
  </div>;
}

type PopoverCloseProps = PopoverClosePrimitiveProps;

function PopoverClose(props: PopoverCloseProps) {
  return <PopoverClosePrimitive {...props} />;
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverViewport,
  PopoverClose,
  type PopoverProps,
  type PopoverTriggerProps,
  type PopoverContentProps,
  type PopoverViewportProps,
  type PopoverCloseProps,
};
