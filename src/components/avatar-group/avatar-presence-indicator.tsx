'use client';

/** Shared tokenized status decoration; callers own enablement and freshness. */

import { cn } from '../../lib/utils';
import type { AvatarPresenceIndicatorProps } from './avatar-group-types';

/** Omit disabled/unknown presence instead of presenting it as offline. */
export function AvatarPresenceIndicator({
  presence, enabled = false, className, ...props
}: AvatarPresenceIndicatorProps) {
  if (!enabled || !presence) return null;
  return (
    <span
      {...props}
      data-slot="avatar-presence-indicator"
      data-tone={presence.tone}
      data-variant={presence.variant ?? 'ring'}
      aria-hidden="true"
      className={cn('zero-avatar-presence-indicator', className)}
    >
      {(presence.variant === 'badge') && presence.icon}
    </span>
  );
}
