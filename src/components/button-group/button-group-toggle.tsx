'use client';

/**
 * button-group-toggle.tsx
 *
 * Adds controlled/uncontrolled single and multiple selection to grouped Zero
 * Buttons. Radix owns pressed state and roving focus; this layer owns styling.
 */

import * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { Button, type ButtonProps } from '../ui/button';
import { cn } from '#zero/lib/utils';
import { ButtonGroupOrientationProvider } from './button-group';
import { buttonGroupVariants, type ButtonGroupLayoutProps } from './button-group-styles';

/** Selection controls share Button's compact size scale, not icon-only widths. */
export type ButtonGroupToggleSize = 'xs' | 'sm' | 'default' | 'lg';
/** Outline joins bordered controls; default uses a lighter ghost treatment. */
export type ButtonGroupToggleVariant = 'outline' | 'default';

interface ToggleStyle {
  size?: ButtonGroupToggleSize;
  variant?: ButtonGroupToggleVariant;
}
const ButtonGroupToggleContext = React.createContext<Required<ToggleStyle>>({ size: 'default', variant: 'outline' });

/** Radix's discriminated value contract is preserved for single/multiple mode. */
export type ButtonGroupToggleProps = React.ComponentProps<typeof ToggleGroupPrimitive.Root> & ButtonGroupLayoutProps & ToggleStyle;

/** Render selectable actions with native Radix roving focus, disabled state and pressed semantics. */
export function ButtonGroupToggle({ className, children, orientation = 'horizontal', spacing = 'joined', size = 'default', variant = 'outline', ...props }: ButtonGroupToggleProps) {
  const resolvedOrientation = orientation ?? 'horizontal';
  const resolvedSpacing = spacing ?? 'joined';
  return (
    <ButtonGroupOrientationProvider value={resolvedOrientation}>
      <ButtonGroupToggleContext.Provider value={{ size, variant }}>
        <ToggleGroupPrimitive.Root data-slot="button-group-toggle" data-spacing={resolvedSpacing} data-size={size} data-variant={variant}
          orientation={resolvedOrientation} className={cn(buttonGroupVariants({ orientation: resolvedOrientation, spacing: resolvedSpacing }), className)} {...props}>
          {children}
        </ToggleGroupPrimitive.Root>
      </ButtonGroupToggleContext.Provider>
    </ButtonGroupOrientationProvider>
  );
}

/** An individually disabled/native Button item; value must be unique within its group. */
export type ButtonGroupToggleItemProps = React.ComponentProps<typeof ToggleGroupPrimitive.Item> & ToggleStyle & Pick<ButtonProps, 'animateIcon'>;

/** Render a selectable Zero Button; size/variant overrides do not alter sibling props. */
export function ButtonGroupToggleItem({ className, children, size, variant, asChild = false, animateIcon = true, ...props }: ButtonGroupToggleItemProps) {
  const context = React.useContext(ButtonGroupToggleContext);
  const resolvedSize = size ?? context.size;
  const resolvedVariant = variant ?? context.variant;
  return (
    <ToggleGroupPrimitive.Item asChild {...props}>
      <Button asChild={asChild} size={resolvedSize} variant={resolvedVariant === 'outline' ? 'outline' : 'ghost'} animateIcon={animateIcon}
        data-slot="button-group-toggle-item" data-group-variant={resolvedVariant}
        className={cn('data-[state=on]:border-primary/30 data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:hover:bg-primary/15', className)}>
        {children}
      </Button>
    </ToggleGroupPrimitive.Item>
  );
}
