/**
 * heading.tsx
 *
 * Provides optional native heading semantics over the shared CSS typography
 * roles. HTML hierarchy and visual size are independent; no layout or theme
 * provider is introduced, and application authors own the document outline.
 */

import * as React from 'react';
import { Slot } from 'radix-ui';
import type { TypographyRole } from '../../design-system/theme-typography';
import type { TypographyChildren } from './text';
import { assertTypographySlotChild } from './typography-slot';

/** Native heading levels, selected from the document outline rather than size. */
export type HeadingElement = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/** Heading native attributes/ref follow `as`; styling uses a separate recipe. */
export type HeadingProps<Element extends HeadingElement = 'h2'> = {
  as?: Element;
  variant?: TypographyRole;
} & TypographyChildren & Omit<
  React.ComponentPropsWithRef<NoInfer<Element>>,
  'as' | 'children' | 'variant'
>;

/**
 * Render a native h2 by default; change its level without changing its recipe.
 * An asChild component must preserve heading semantics and forward props/ref.
 */
export function Heading<Element extends HeadingElement = 'h2'>({
  as,
  asChild = false,
  variant = 'section',
  ...props
}: HeadingProps<Element>) {
  if (asChild) assertTypographySlotChild(props.children);
  const Comp: React.ElementType = asChild ? Slot.Root : (as ?? 'h2');
  return <Comp {...props} data-slot="heading" data-zero-typography={variant} />;
}
