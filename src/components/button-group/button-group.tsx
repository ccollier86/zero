'use client';

/**
 * button-group.tsx
 *
 * Composes existing Zero controls into joined action groups and themed addons.
 * It does not clone child controls, infer selection, or disable app actions.
 */

import * as React from 'react';
import { Slot } from 'radix-ui';
import { type VariantProps } from 'class-variance-authority';
import { Separator } from '../ui/separator';
import { cn } from '#zero/lib/utils';
import { buttonGroupTextVariants, buttonGroupVariants, type ButtonGroupLayoutProps } from './button-group-styles';

const ButtonGroupOrientationContext = React.createContext<'horizontal' | 'vertical'>('horizontal');

/** Native container props and layout; child Button/Input/Select props stay intact. */
export type ButtonGroupProps = React.ComponentProps<'div'> & ButtonGroupLayoutProps & { asChild?: boolean };

/** Group related actions. Label with aria-label/aria-labelledby; asChild accepts a native fieldset. */
export function ButtonGroup({ className, orientation = 'horizontal', spacing = 'joined', asChild = false, children, ...props }: ButtonGroupProps) {
  const Comp = asChild ? Slot.Root : 'div';
  const resolvedOrientation = orientation ?? 'horizontal';
  const resolvedSpacing = spacing ?? 'joined';
  return (
    <ButtonGroupOrientationContext.Provider value={resolvedOrientation}>
      <Comp role="group" data-slot="button-group" data-orientation={resolvedOrientation} data-spacing={resolvedSpacing}
        className={cn(buttonGroupVariants({ orientation: resolvedOrientation, spacing: resolvedSpacing }), className)} {...props}>
        {children}
      </Comp>
    </ButtonGroupOrientationContext.Provider>
  );
}

/** Token-aware label/count addon; asChild can retain an application's native label or link. */
export type ButtonGroupTextProps = React.ComponentProps<'div'> & VariantProps<typeof buttonGroupTextVariants> & { asChild?: boolean };

/** Render non-action text beside grouped controls without making it focusable. */
export function ButtonGroupText({ className, size = 'default', asChild = false, ...props }: ButtonGroupTextProps) {
  const Comp = asChild ? Slot.Root : 'div';
  return <Comp data-slot="button-group-text" data-size={size} className={cn(buttonGroupTextVariants({ size }), className)} {...props} />;
}

/** Separator props; omitted orientation is perpendicular to the surrounding group. */
export type ButtonGroupSeparatorProps = React.ComponentProps<typeof Separator>;

/** Divide adjoining controls while reusing Zero's decorative Separator primitive. */
export function ButtonGroupSeparator({ className, orientation, ...props }: ButtonGroupSeparatorProps) {
  const groupOrientation = React.useContext(ButtonGroupOrientationContext);
  const resolvedOrientation = orientation ?? (groupOrientation === 'horizontal' ? 'vertical' : 'horizontal');
  return <Separator data-slot="button-group-separator" orientation={resolvedOrientation}
    className={cn('relative z-[1] self-stretch bg-border-strong data-[orientation=horizontal]:mx-1 data-[orientation=horizontal]:w-auto data-[orientation=vertical]:my-1 data-[orientation=vertical]:h-auto', className)} {...props} />;
}

/** Internal composition boundary used by toggle groups so addons share orientation. */
export const ButtonGroupOrientationProvider = ButtonGroupOrientationContext.Provider;
