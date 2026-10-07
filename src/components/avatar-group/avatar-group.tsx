'use client';

/**
 * avatar-group.tsx
 *
 * Renders REUI's compact stacked-avatar/count/optional-add composition using
 * Zero's existing primitives. It owns presentation only, never membership
 * changes, presence tracking, credential policy or network subscriptions.
 */

import type { CSSProperties } from 'react';
import { useReducedMotion } from 'motion/react';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { Button } from '../ui/button';
import { Plus } from '../animate-ui/icons/plus';
import { AvatarGroup as AnimatedAvatarGroup } from '../animate-ui/primitives/animate/avatar-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';
import { cn } from '../../lib/utils';
import { AvatarPresenceIndicator } from './avatar-presence-indicator';
import { avatarGroupInitials, avatarGroupMemberLabel, resolveAvatarGroupLayout } from './avatar-group-layout';
import type { AvatarGroupProps } from './avatar-group-types';

/** Accessible avatar stack with optional overflow and separately authorized add. */
export function AvatarGroup({
  members, maxVisible = 3, totalCount, size = 'default', shape = 'circle',
  countDisplay = 'number', onCountClick, addAction, presenceEnabled = false,
  animated = true, className, style, ...props
}: AvatarGroupProps) {
  const reducedMotion = useReducedMotion();
  const motionEnabled = animated && !reducedMotion;
  const { visible, remaining } = resolveAvatarGroupLayout(members, maxVisible, totalCount);
  const countLabel = `${remaining} more ${remaining === 1 ? 'member' : 'members'}`;
  const addLabel = addAction?.label ?? 'Add user';
  const metrics = {
    '--zero-avatar-group-avatar-size': `var(--zero-avatar-group-size-${size}, ${size === 'sm' ? '1.5rem' : size === 'lg' ? '2.5rem' : '2rem'})`,
    '--zero-avatar-group-radius': shape === 'circle' ? 'var(--zero-avatar-group-circle-radius, 9999px)'
      : shape === 'rounded' ? 'var(--zero-avatar-group-rounded-radius, var(--radius, 0.375rem))'
      : 'var(--zero-avatar-group-square-radius, 0px)',
    ...style,
  } as CSSProperties;
  const tooltipTransition = motionEnabled ? undefined : { duration: 0 };
  const count = remaining > 0 ? (
    <Tooltip key="__overflow">
      <TooltipTrigger asChild>
        {onCountClick ? (
          <Button type="button" variant="secondary" size="icon" animateIcon={false}
            className="zero-avatar-group-count" aria-label={countLabel} onClick={onCountClick}>
            {countDisplay === 'icon' ? <Plus className="size-[var(--zero-avatar-group-icon-size,1rem)]" aria-hidden="true" /> : `+${remaining}`}
          </Button>
        ) : (
          <span role="img" tabIndex={0} className="zero-avatar-group-count" aria-label={countLabel}>
            {countDisplay === 'icon' ? <Plus className="size-[var(--zero-avatar-group-icon-size,1rem)]" aria-hidden="true" /> : `+${remaining}`}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent transition={tooltipTransition}>{countLabel}</TooltipContent>
    </Tooltip>
  ) : null;
  const avatars = visible.map((member) => {
    const label = avatarGroupMemberLabel(member, presenceEnabled);
    return (
      <Tooltip key={`member:${member.id}`}>
        <TooltipTrigger asChild>
          <span role="img" tabIndex={0} aria-label={label} className="zero-avatar-group-member">
            <Avatar className="zero-avatar-group-image">
              {member.src ? <AvatarImage src={member.src} alt="" /> : null}
              <AvatarFallback className="zero-avatar-group-fallback">{member.fallback ?? avatarGroupInitials(member.name)}</AvatarFallback>
            </Avatar>
            <AvatarPresenceIndicator enabled={presenceEnabled} presence={member.presence} />
          </span>
        </TooltipTrigger>
        <TooltipContent transition={tooltipTransition}>{label}</TooltipContent>
      </Tooltip>
    );
  });
  return (
    <div {...props} data-slot="avatar-group" data-size={size} data-shape={shape}
      className={cn('zero-avatar-group', className)} style={metrics}>
      <AnimatedAvatarGroup className="zero-avatar-group-stack" tooltips={false}
        translate={motionEnabled ? 'var(--zero-avatar-group-lift, -3px)' : 0}
        transition={motionEnabled ? undefined : { duration: 0 }}
        tooltipTransition={tooltipTransition}>
        {[...avatars, ...(count ? [count] : [])]}
      </AnimatedAvatarGroup>
      {addAction && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="zero-avatar-group-add"
              animateIcon={motionEnabled}
              aria-label={addLabel} disabled={addAction.disabled || addAction.pending}
              aria-busy={addAction.pending || undefined} onClick={addAction.onClick}>
              <Plus className="size-[var(--zero-avatar-group-icon-size,1rem)]" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent transition={tooltipTransition}>{addLabel}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
