import * as React from 'react';

import {
  Popover as PopoverPrimitive,
  PopoverTrigger as PopoverTriggerPrimitive,
  PopoverContent as PopoverContentPrimitive,
  PopoverPortal as PopoverPortalPrimitive,
  PopoverClose as PopoverClosePrimitive,
  type PopoverProps as PopoverPrimitiveProps,
  type PopoverTriggerProps as PopoverTriggerPrimitiveProps,
  type PopoverContentProps as PopoverContentPrimitiveProps,
  type PopoverCloseProps as PopoverClosePrimitiveProps,
} from '#zero/components/animate-ui/primitives/radix/popover';
import { cn } from '#zero/lib/utils';
import { useOwnedFloatingOverlay, composeOverlayRefs } from '../../../overlays/overlay-scope';

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
  return (
    <PopoverPortalPrimitive container={portalContainer ?? floating.owner?.container}>
      <PopoverContentPrimitive
        {...floating.contentProps}
        ref={composeOverlayRefs(floating.ref, ref)}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border border-border/85 bg-popover p-4 text-popover-foreground shadow-lg outline-hidden dark:shadow-none',
          className,
        )}
        {...props}
        style={{ ...floating.contentProps.style, ...style }}
      />
    </PopoverPortalPrimitive>
  );
}

type PopoverCloseProps = PopoverClosePrimitiveProps;

function PopoverClose(props: PopoverCloseProps) {
  return <PopoverClosePrimitive {...props} />;
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
  type PopoverProps,
  type PopoverTriggerProps,
  type PopoverContentProps,
  type PopoverCloseProps,
};
