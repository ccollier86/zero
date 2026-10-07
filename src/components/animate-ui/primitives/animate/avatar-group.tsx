'use client';

import * as React from 'react';
import { HTMLMotionProps, motion, type Transition } from 'motion/react';

import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipArrow,
  type TooltipProviderProps,
  type TooltipProps,
  type TooltipContentProps,
  type TooltipArrowProps,
} from '#zero/components/animate-ui/primitives/animate/tooltip';

type AvatarProps = Omit<HTMLMotionProps<'div'>, 'translate'> & {
  children: React.ReactNode;
  zIndex: number;
  translate?: string | number;
  tooltips?: boolean;
} & Omit<TooltipProps, 'children'>;

function AvatarContainer({
  zIndex,
  translate,
  side,
  sideOffset,
  align,
  alignOffset,
  tooltips = true,
  ...props
}: AvatarProps) {
  const avatar = (
    <motion.div
      data-slot="avatar-container"
      initial="initial"
      whileHover="hover"
      whileTap={tooltips ? 'hover' : undefined}
      style={{ position: 'relative', zIndex }}
    >
      <motion.div
        variants={{ initial: { y: 0 }, hover: { y: translate } }}
        {...props}
      />
    </motion.div>
  );
  if (!tooltips) return avatar;
  return (
    <Tooltip
      side={side}
      sideOffset={sideOffset}
      align={align}
      alignOffset={alignOffset}
    >
      <TooltipTrigger asChild>
        {avatar}
      </TooltipTrigger>
    </Tooltip>
  );
}

type AvatarGroupProps = Omit<React.ComponentProps<'div'>, 'translate'> & {
  children: React.ReactElement[];
  invertOverlap?: boolean;
  translate?: string | number;
  transition?: Transition;
  tooltipTransition?: Transition;
  /** Disable legacy tooltips when a composition supplies its own triggers. */
  tooltips?: boolean;
} & Omit<TooltipProviderProps, 'children'> &
  Omit<TooltipProps, 'children'>;

function AvatarGroup({
  ref,
  children,
  id,
  transition = { type: 'spring', stiffness: 300, damping: 17 },
  invertOverlap = false,
  translate = '-30%',
  openDelay = 0,
  closeDelay = 0,
  side = 'top',
  sideOffset = 25,
  align = 'center',
  alignOffset = 0,
  tooltipTransition = { type: 'spring', stiffness: 300, damping: 35 },
  tooltips = true,
  style,
  ...props
}: AvatarGroupProps) {
  const group = (
      <div
        ref={ref}
        data-slot="avatar-group"
        style={{
          display: 'flex',
          alignItems: 'center',
          ...style,
        }}
        {...props}
      >
        {children?.map((child, index) => (
          <AvatarContainer
            key={child.key ?? index}
            zIndex={
              invertOverlap ? React.Children.count(children) - index : index
            }
            transition={transition}
            translate={translate}
            side={side}
            sideOffset={sideOffset}
            align={align}
            alignOffset={alignOffset}
            tooltips={tooltips}
          >
            {child}
          </AvatarContainer>
        ))}
      </div>
  );
  if (!tooltips) return group;
  return (
    <TooltipProvider
      id={id}
      openDelay={openDelay}
      closeDelay={closeDelay}
      transition={tooltipTransition}
    >
      {group}
    </TooltipProvider>
  );
}

type AvatarGroupTooltipProps = TooltipContentProps;

function AvatarGroupTooltip(props: AvatarGroupTooltipProps) {
  return <TooltipContent {...props} />;
}

type AvatarGroupTooltipArrowProps = TooltipArrowProps;

function AvatarGroupTooltipArrow(props: AvatarGroupTooltipArrowProps) {
  return <TooltipArrow {...props} />;
}

export {
  AvatarGroup,
  AvatarGroupTooltip,
  AvatarGroupTooltipArrow,
  type AvatarGroupProps,
  type AvatarGroupTooltipProps,
  type AvatarGroupTooltipArrowProps,
};
