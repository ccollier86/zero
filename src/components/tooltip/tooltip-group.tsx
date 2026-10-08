'use client';

/** Public group adapter over Zero's existing singleton Floating UI primitive. */
import * as React from 'react';
import {
  TooltipProvider as SharedProvider, Tooltip as SharedTooltip, TooltipTrigger as SharedTrigger,
  TooltipContent as SharedContent, TooltipArrow,
  useTooltip as useSharedTooltip,
  useGlobalTooltip,
  type TooltipProviderProps as SharedProviderProps, type TooltipProps as SharedTooltipProps,
  type TooltipTriggerProps as SharedTriggerProps, type TooltipContentProps as SharedContentProps,
  type TooltipContentPlacement,
} from '../animate-ui/primitives/animate/tooltip';
import type { TooltipMotionOptions } from './tooltip-motion-types';
import { cn } from '#zero/lib/utils';

const GroupContext = React.createContext<TooltipGroupProps | null>(null);
export type TooltipGroupProps = TooltipMotionOptions & {
  children: React.ReactNode; delayDuration?: number; skipDelayDuration?: number; closeDelay?: number;
  disableHoverableContent?: boolean;
};
export function useTooltipGroup() { return React.useContext(GroupContext); }
export function TooltipGroup({ children, delayDuration, skipDelayDuration, closeDelay, disableHoverableContent, ...options }: TooltipGroupProps) {
  const config = React.useMemo(() => ({ children: null, delayDuration, skipDelayDuration, closeDelay, disableHoverableContent, ...options }),
    [delayDuration, skipDelayDuration, closeDelay, disableHoverableContent, options.motion, options.durationMultiplier, options.arrow, options.variant]);
  return <GroupContext.Provider value={config}><SharedProvider {...options} openDelay={delayDuration}
    warmDelay={skipDelayDuration} closeDelay={closeDelay}>{children}</SharedProvider></GroupContext.Provider>;
}
export type GroupTooltipProps = SharedTooltipProps & { followCursor?: boolean | 'x' | 'y'; followCursorSpringOptions?: object; disableHoverableContent?: boolean };
export function GroupTooltip({ followCursor, followCursorSpringOptions: _spring, disableHoverableContent, ...props }: GroupTooltipProps) {
  const group = useTooltipGroup();
  if (followCursor) throw new TypeError('TooltipGroup uses anchored placement; use motion="swing" for cursor drift or an ordinary Tooltip for followCursor.');
  return <SharedTooltip {...props} disableHoverableContent={disableHoverableContent ?? group?.disableHoverableContent} />;
}
export type GroupTooltipTriggerProps = React.ComponentProps<'button'> & { asChild?: boolean };
export function GroupTooltipTrigger({ asChild, children, ...props }: GroupTooltipTriggerProps) {
  return asChild ? <SharedTrigger asChild {...props as unknown as SharedTriggerProps}>{children as React.ReactElement}</SharedTrigger>
    : <SharedTrigger asChild><button type="button" {...props}>{children}</button></SharedTrigger>;
}
export type GroupTooltipContentProps = Omit<SharedContentProps, 'asChild' | 'children'> & TooltipContentPlacement & { children?: React.ReactNode };
export function GroupTooltipContent({ className, children, side, sideOffset, align, alignOffset,
  collisionPadding, avoidCollisions, collisionBoundary, arrowPadding, hideWhenDetached, sticky,
  updatePositionStrategy, container, arrow, ...props }: GroupTooltipContentProps) {
  const local = useSharedTooltip(), group = useTooltipGroup(), global = useGlobalTooltip();
  // Content placement matches the public Radix family without constructing another host.
  React.useLayoutEffect(() => {
    const placement = { side: side ?? local.side, sideOffset: sideOffset ?? local.sideOffset,
      align: align ?? local.align, alignOffset: alignOffset ?? local.alignOffset,
      collisionPadding: collisionPadding ?? local.collisionPadding, avoidCollisions: avoidCollisions ?? local.avoidCollisions,
      collisionBoundary, arrowPadding, hideWhenDetached, sticky, updatePositionStrategy, container };
    local.contentPlacementRef.current = placement; global.refreshPlacement(local.id, placement);
  }, [local.contentPlacementRef, global.refreshPlacement, local.id, local.side, local.sideOffset, local.align, local.alignOffset,
    local.collisionPadding, local.avoidCollisions, side, sideOffset, align, alignOffset,
    collisionPadding, avoidCollisions, collisionBoundary, arrowPadding, hideWhenDetached, sticky, updatePositionStrategy, container]);
  const showArrow = arrow ?? local.optionsRef.current.arrow ?? group?.arrow;
  return <SharedContent {...props} arrow={showArrow} className={cn('zero-tooltip', className)}>
    {children}
    {showArrow !== false && <TooltipArrow className="zero-tooltip-arrow" width={9} height={5} tipRadius={1} />}
  </SharedContent>;
}
export type { SharedProviderProps };
