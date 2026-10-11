/** Public action-tray contracts; callbacks report intent, never imply transport, selection or accepted persistence. */
import type * as React from 'react';

/** Quiet inline material or raised material; neither positions or portals the tray. */
export type FloatingButtonGroupVariant = 'muted' | 'floating';
/** Reference densities; the active theme's minimum hit target remains authoritative. */
export type FloatingButtonGroupSize = 'sm' | 'md';
/** Action navigation axis, independent from persistent mode state. */
export type FloatingButtonGroupOrientation = 'horizontal' | 'vertical';

/** One named native command. Shortcut is a hint, and pressed is application-owned mode feedback. */
export interface FloatingButtonGroupAction {
  readonly type?: 'action';
  readonly id: string;
  readonly label: string;
  readonly icon?: React.ReactNode;
  readonly iconOnly?: boolean;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly shortcut?: string;
  readonly reserveLabels?: readonly string[];
  readonly onSelect?: () => void;
  /** Native action ref, including React 19 callback cleanup. */
  readonly ref?: React.Ref<HTMLButtonElement>;
}

/** A noninteractive cluster boundary perpendicular to the navigation axis. */
export interface FloatingButtonGroupSeparator { readonly type: 'separator'; readonly id?: string }
/** Ordered actions and cluster boundaries; explicit IDs must be unique. */
export type FloatingButtonGroupItem = FloatingButtonGroupAction | FloatingButtonGroupSeparator;

/** Complete local action tray; native div handlers/ref remain composable. No implicit global shortcut or write owner. */
export interface FloatingButtonGroupProps extends Omit<React.ComponentProps<'div'>, 'children' | 'role' | 'aria-label' | 'aria-orientation'> {
  readonly items: readonly FloatingButtonGroupItem[];
  readonly label: string;
  readonly variant?: FloatingButtonGroupVariant;
  readonly size?: FloatingButtonGroupSize;
  readonly orientation?: FloatingButtonGroupOrientation;
  readonly iconOnly?: boolean;
  readonly tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  /** Runs after the item's synchronous callback returns; promises are not awaited or deduplicated. */
  readonly onAction?: (id: string) => void;
  readonly dir?: 'ltr' | 'rtl';
}
