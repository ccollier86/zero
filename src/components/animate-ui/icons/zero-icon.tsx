'use client';

/**
 * zero-icon.tsx
 *
 * Renders a Zero animated icon by registry name. This file owns dynamic icon
 * rendering only; it does not define icon metadata or application semantics.
 */

import type { IconProps } from './icon';
import { getZeroAnimatedIcon, type ZeroAnimatedIconName } from './registry';

export interface ZeroIconProps extends IconProps<any> {
  /** Canonical kebab-case name from Zero's animated icon registry. */
  name: ZeroAnimatedIconName;
}

/**
 * Render an animated platform icon by canonical registry name.
 *
 * Use named icon imports when the icon is known at compile time. Use ZeroIcon
 * for schema/config-driven UI where the icon name is data.
 */
export function ZeroIcon({ name, ...props }: ZeroIconProps) {
  const Icon = getZeroAnimatedIcon(name);
  return <Icon {...props} />;
}
