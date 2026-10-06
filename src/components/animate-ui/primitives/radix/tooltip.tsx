'use client';

/**
 * Owns Radix tooltip state, placement, cursor tracking and portal animation.
 * Reuses Zero's state/DOM hooks; callers own content and activation policy.
 */
import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  type SpringOptions,
  type HTMLMotionProps,
  type MotionValue,
} from 'motion/react';

import { getStrictContext } from '#zero/lib/get-strict-context';
import { useControlledState } from '#zero/hooks/use-controlled-state';
import { useDataState } from '#zero/hooks/use-data-state';

type TooltipContextType = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  x: MotionValue<number>;
  y: MotionValue<number>;
  followCursor?: boolean | 'x' | 'y';
  followCursorSpringOptions?: SpringOptions;
};

const [LocalTooltipProvider, useTooltip] =
  getStrictContext<TooltipContextType>('TooltipContext');

type TooltipProviderProps = React.ComponentProps<
  typeof TooltipPrimitive.Provider
>;

function TooltipProvider(props: TooltipProviderProps) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} />;
}

type TooltipProps = React.ComponentProps<typeof TooltipPrimitive.Root> & {
  followCursor?: boolean | 'x' | 'y';
  followCursorSpringOptions?: SpringOptions;
};

function Tooltip({
  followCursor = false,
  followCursorSpringOptions = { stiffness: 200, damping: 17 },
  ...props
}: TooltipProps) {
  const [isOpen, setIsOpen] = useControlledState({
    value: props?.open,
    defaultValue: props?.defaultOpen,
    onChange: props?.onOpenChange,
  });
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  return (
    <LocalTooltipProvider
      value={{
        isOpen,
        setIsOpen,
        x,
        y,
        followCursor,
        followCursorSpringOptions,
      }}
    >
      <TooltipPrimitive.Root
        data-slot="tooltip"
        {...props}
        onOpenChange={setIsOpen}
      />
    </LocalTooltipProvider>
  );
}

type TooltipTriggerProps = React.ComponentProps<
  typeof TooltipPrimitive.Trigger
>;

function TooltipTrigger({ onMouseMove, ...props }: TooltipTriggerProps) {
  const { x, y, followCursor } = useTooltip();

  const handleMouseMove = (event: React.MouseEvent<HTMLButtonElement>) => {
    onMouseMove?.(event);

    const target = event.currentTarget.getBoundingClientRect();

    if (followCursor === 'x' || followCursor === true) {
      const eventOffsetX = event.clientX - target.left;
      const offsetXFromCenter = (eventOffsetX - target.width / 2) / 2;
      x.set(offsetXFromCenter);
    }

    if (followCursor === 'y' || followCursor === true) {
      const eventOffsetY = event.clientY - target.top;
      const offsetYFromCenter = (eventOffsetY - target.height / 2) / 2;
      y.set(offsetYFromCenter);
    }
  };

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onMouseMove={handleMouseMove}
      {...props}
    />
  );
}

type TooltipPortalProps = Omit<
  React.ComponentProps<typeof TooltipPrimitive.Portal>,
  'forceMount'
>;

function TooltipPortal(props: TooltipPortalProps) {
  return (
    <TooltipPrimitive.Portal
      forceMount
      data-slot="tooltip-portal"
      {...props}
    />
  );
}

type TooltipContentProps = Omit<
  React.ComponentProps<typeof TooltipPrimitive.Content>,
  'forceMount' | 'asChild'
> &
  HTMLMotionProps<'div'>;

function TooltipContent({
  'aria-label': ariaLabel,
  dir,
  onEscapeKeyDown,
  onPointerDownOutside,
  side,
  sideOffset,
  align,
  alignOffset,
  avoidCollisions,
  collisionBoundary,
  collisionPadding,
  arrowPadding,
  sticky,
  hideWhenDetached,
  updatePositionStrategy,
  style,
  transition = { type: 'spring', stiffness: 300, damping: 25 },
  ...props
}: TooltipContentProps) {
  const { isOpen, x, y, followCursor, followCursorSpringOptions } = useTooltip();
  const translateX = useSpring(x, followCursorSpringOptions);
  const translateY = useSpring(y, followCursorSpringOptions);
  const [resolvedSide, sideRef] = useDataState<HTMLDivElement>('side');
  const [resolvedAlign, alignRef] = useDataState<HTMLDivElement>('align');
  const [resolvedState, stateRef] = useDataState<HTMLDivElement>('state');
  const placementRef = React.useCallback((element: HTMLDivElement | null) => {
    sideRef.current = element;
    alignRef.current = element;
    stateRef.current = element;
    // Preserve className-based layer overrides as well as inline zIndex before
    // Popper measures the positioned wrapper's stacking level.
    const animated = element?.firstElementChild;
    if (element && animated) {
      const layer = getComputedStyle(animated).zIndex;
      if (layer !== 'auto') element.style.zIndex = layer;
    }
  }, [sideRef, alignRef, stateRef, props.className, style?.zIndex]);

  return (
    // Keep presence inside the portal and animation on a native element.
    // Radix owns placement and its hidden description, without an asChild Slot
    // boundary between separately installed copies of the Slot primitive.
    <AnimatePresence>
      {isOpen && (
        <TooltipPrimitive.Content
          forceMount
          ref={placementRef}
          aria-label={ariaLabel}
          dir={dir}
          // Popper reads the positioned element's stacking level, not its
          // animated child. Keep the standard tooltip layer and style override.
          style={{ zIndex: style?.zIndex ?? 50 }}
          align={align}
          alignOffset={alignOffset}
          side={side}
          sideOffset={sideOffset}
          avoidCollisions={avoidCollisions}
          collisionBoundary={collisionBoundary}
          collisionPadding={collisionPadding}
          arrowPadding={arrowPadding}
          sticky={sticky}
          hideWhenDetached={hideWhenDetached}
          updatePositionStrategy={updatePositionStrategy}
          onEscapeKeyDown={onEscapeKeyDown}
          onPointerDownOutside={onPointerDownOutside}
          key="popover-content"
        >
          <motion.div
            data-slot="popover-content"
            dir={dir}
            data-side={typeof resolvedSide === 'string' ? resolvedSide : undefined}
            data-align={typeof resolvedAlign === 'string' ? resolvedAlign : undefined}
            data-state={typeof resolvedState === 'string' ? resolvedState : undefined}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={transition}
            style={{
              x:
                followCursor === 'x' || followCursor === true
                  ? translateX
                  : undefined,
              y:
                followCursor === 'y' || followCursor === true
                  ? translateY
                  : undefined,
              ...style,
            }}
            {...props}
          />
        </TooltipPrimitive.Content>
      )}
    </AnimatePresence>
  );
}

type TooltipArrowProps = React.ComponentProps<typeof TooltipPrimitive.Arrow>;

function TooltipArrow(props: TooltipArrowProps) {
  return <TooltipPrimitive.Arrow data-slot="tooltip-arrow" {...props} />;
}

export {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipArrow,
  useTooltip,
  type TooltipProviderProps,
  type TooltipProps,
  type TooltipTriggerProps,
  type TooltipPortalProps,
  type TooltipContentProps,
  type TooltipArrowProps,
  type TooltipContextType,
};
