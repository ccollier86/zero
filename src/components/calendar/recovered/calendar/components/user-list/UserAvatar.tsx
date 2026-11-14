'use client';

import { Avatar, Indicator } from '../../../../components/calendar-ui';
import type { CalendarUser } from '../../types/index';

export interface UserAvatarProps {
  user: CalendarUser;
  isSelected?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Styled avatar for calendar users
 * Shows initials with colored background, optional selection indicator
 */
export function UserAvatar({ user, isSelected = false, size = 'md' }: UserAvatarProps) {
  const sizeMap = {
    sm: 28,
    md: 36,
    lg: 44,
  };

  const avatar = (
    <Avatar
      src={user.avatar}
      alt={user.name}
      radius="xl"
      size={sizeMap[size]}
      color={user.color}
      style={{
        border: isSelected ? `var(--calendar-size-2) solid var(--calendar-color-${user.color}-6)` : 'none',
        boxShadow: isSelected ? `0 0 0 var(--calendar-size-2) var(--calendar-color-${user.color}-2)` : 'none',
      }}
    >
      {user.initials}
    </Avatar>
  );

  if (isSelected) {
    return (
      <Indicator color={user.color} size="var(--calendar-size-8)" offset={2} position="bottom-end">
        {avatar}
      </Indicator>
    );
  }

  return avatar;
}
