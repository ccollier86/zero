/** Native keyboard-hint presentation using Zero tokens; never registers a shortcut. */
import * as React from 'react';
import { cn } from '#zero/lib/utils';

/** Native kbd attributes, including accessible text, inline metrics, children and ref. */
export type KbdProps = React.ComponentPropsWithoutRef<'kbd'>;
/** A sequence of keys; ref and native attributes match the rendered kbd element. */
export type KbdGroupProps = React.ComponentPropsWithoutRef<'kbd'>;

/** Render a display-only key or combination; icon-only hints need an accessible label. */
export const Kbd = React.forwardRef<HTMLElement, KbdProps>(function Kbd({ className, ...props }, ref) {
  return <kbd ref={ref} data-slot="kbd" className={cn('zero-kbd', className)} {...props} />;
});

/** Group related keys without adding focus, click handling or shortcut registration. */
export const KbdGroup = React.forwardRef<HTMLElement, KbdGroupProps>(function KbdGroup({ className, ...props }, ref) {
  return <kbd ref={ref} data-slot="kbd-group" className={cn('zero-kbd-group', className)} {...props} />;
});
