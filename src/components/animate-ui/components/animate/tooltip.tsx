import * as React from 'react';

import {
  TooltipProvider as TooltipProviderPrimitive,
  Tooltip as TooltipPrimitive,
  TooltipTrigger as TooltipTriggerPrimitive,
  TooltipContent as TooltipContentPrimitive,
  TooltipArrow as TooltipArrowPrimitive,
  type TooltipProviderProps as TooltipProviderPrimitiveProps,
  type TooltipProps as TooltipPrimitiveProps,
  type TooltipTriggerProps as TooltipTriggerPrimitiveProps,
  type TooltipContentProps as TooltipContentPrimitiveProps,
} from '#zero/components/animate-ui/primitives/animate/tooltip';
import { cn } from '#zero/lib/utils';
import { useOverlayScope } from '../../../overlays/overlay-scope';

type TooltipProviderProps = TooltipProviderPrimitiveProps;

function TooltipProvider(props: TooltipProviderProps) {
  return <TooltipProviderPrimitive {...props} />;
}

type TooltipProps = TooltipPrimitiveProps;

function Tooltip(props: TooltipProps) {
  return <TooltipPrimitive {...props} />;
}

type TooltipTriggerProps = TooltipTriggerPrimitiveProps;

function TooltipTrigger({ ...props }: TooltipTriggerProps) {
  return <TooltipTriggerPrimitive {...props} />;
}

type TooltipContentProps = Omit<TooltipContentPrimitiveProps, 'asChild'> & {
  children: React.ReactNode;
  layout?: boolean | 'position' | 'size' | 'preserve-aspect';
};

function TooltipContent({
  className,
  children,
  layout = 'preserve-aspect',
  style,
  arrow,
  variant,
  ...props
}: TooltipContentProps) {
  const owner = useOverlayScope();
  return (
    <TooltipContentPrimitive
      className={cn(
        'zero-tooltip',
        className,
      )}
      {...props}
      arrow={arrow}
      variant={variant}
      inert={owner && !owner.active || undefined}
      data-zero-overlay-owner={owner?.id}
      style={{ ...owner?.themeStyle, ...style, ...(owner ? { zIndex: owner.zIndex + 2,
        ...(!owner.active ? { pointerEvents: 'none' } : {}) } : {}) }}
    >
      <div className="zero-tooltip-body" data-layout={layout}>{children}</div>
      {arrow !== false && <TooltipArrowPrimitive className="zero-tooltip-arrow" width={9} height={5} tipRadius={1} />}
    </TooltipContentPrimitive>
  );
}

export {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  type TooltipProviderProps,
  type TooltipProps,
  type TooltipTriggerProps,
  type TooltipContentProps,
};
