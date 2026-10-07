/** Presentation contracts for compact avatar stacks; no presence transport. */

import type { ComponentProps, MouseEventHandler, ReactNode } from 'react';

export type AvatarGroupSize = 'sm' | 'default' | 'lg';
export type AvatarGroupShape = 'circle' | 'rounded' | 'square';
export type AvatarPresenceTone = 'success' | 'warning' | 'destructive' | 'muted' | 'primary';

/** An admitted observation mapped to visual tokens by the consuming app. */
export interface AvatarPresence {
  readonly label: string;
  readonly tone: AvatarPresenceTone;
  readonly icon?: ReactNode;
  readonly variant?: 'ring' | 'dot' | 'badge';
}

/** Identity/image presentation; presence metadata does not grant authority. */
export interface AvatarGroupMember {
  readonly id: string;
  readonly name: string;
  readonly src?: string;
  readonly fallback?: ReactNode;
  readonly presence?: AvatarPresence;
}

/** Optional separate add control. The app owns permissions and the operation. */
export interface AvatarGroupAddAction {
  readonly label?: string;
  readonly onClick: MouseEventHandler<HTMLButtonElement>;
  readonly disabled?: boolean;
  readonly pending?: boolean;
}

/** Compact REUI-style stack composed from Zero avatars, motion and controls. */
export interface AvatarGroupProps extends Omit<ComponentProps<'div'>, 'children'> {
  readonly members: readonly AvatarGroupMember[];
  readonly maxVisible?: number;
  readonly totalCount?: number;
  readonly size?: AvatarGroupSize;
  readonly shape?: AvatarGroupShape;
  readonly countDisplay?: 'number' | 'icon';
  readonly onCountClick?: MouseEventHandler<HTMLButtonElement>;
  readonly addAction?: AvatarGroupAddAction;
  /** False omits all status visuals/labels; this never creates a tracker. */
  readonly presenceEnabled?: boolean;
  readonly animated?: boolean;
}

/** Reusable status decoration using its parent's size and corner tokens. */
export interface AvatarPresenceIndicatorProps extends Omit<ComponentProps<'span'>, 'children'> {
  readonly presence?: AvatarPresence;
  readonly enabled?: boolean;
}
