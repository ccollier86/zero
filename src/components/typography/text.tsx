/**
 * text.tsx
 *
 * Provides optional native text semantics over the shared CSS typography roles.
 * It owns no theme provider, font loading, paint, layout or text transformation.
 */

import * as React from 'react';
import { Slot } from 'radix-ui';
import type { TypographyRole } from '../../design-system/theme-typography';
import { assertTypographySlotChild } from './typography-slot';

/** Native text tags; labels still require the caller's htmlFor association. */
export type TextElement = 'span' | 'p' | 'div' | 'small' | 'strong' | 'em' | 'code' | 'kbd' | 'label';

/** Slot composition requires one non-Fragment element; native rendering accepts ordinary text. */
export type TypographyChildren =
  | { asChild?: false; children?: React.ReactNode }
  | { asChild: true; children: React.ReactElement };

/** Text's native props/ref follow `as`; `variant` is visual, not an ARIA role. */
export type TextProps<Element extends TextElement = 'span'> = {
  as?: Element;
  variant?: TypographyRole;
} & TypographyChildren & Omit<
  React.ComponentPropsWithRef<NoInfer<Element>>,
  'as' | 'children' | 'variant'
>;

/**
 * Render one native text node using a CSS recipe, without adding a required
 * wrapper around existing controls. With asChild, the caller owns semantics;
 * a custom child must forward props/ref to its native node. `as` does not infer
 * a visual recipe: use variant="technical" for code and explicit emphasis roles.
 */
export function Text<Element extends TextElement = 'span'>({
  as,
  asChild = false,
  variant = 'body',
  ...props
}: TextProps<Element>) {
  if (asChild) assertTypographySlotChild(props.children);
  const Comp: React.ElementType = asChild ? Slot.Root : (as ?? 'span');
  return <Comp {...props} data-slot="text" data-zero-typography={variant} />;
}
