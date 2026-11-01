'use client';

/**
 * user-detail-header.tsx
 *
 * Renders the selected user's compact detail header for the reusable admin
 * user-management organism. This file owns presentation only; user mutations
 * and auth policy live in sibling hook/component files.
 */

import { motion } from 'motion/react';
import { Avatar, AvatarFallback, AvatarImage } from '../../ui/avatar';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import type { UserManagementUser } from './user-management-types';
import { useUserDetailAvatar } from './use-user-detail-avatar';

export interface UserDetailHeaderProps {
  user: UserManagementUser;
  /** Human-readable global-role label; the stored role value is unchanged. */
  roleLabel?: string;
  className?: string;
}

/** Render the selected user's compact identity, role, and lifecycle state. */
export function UserDetailHeader({ user, roleLabel, className }: UserDetailHeaderProps) {
  const imageUrl = useUserDetailAvatar(user);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
  const identity = user.username.toLowerCase() === user.email.toLowerCase()
    ? user.email
    : `@${user.username} · ${user.email}`;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Do not retain an exiting account's photo beside the next account's name. */}
      <motion.div
        key={user.id}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        <Avatar className="size-11" aria-hidden="true">
          <AvatarImage src={imageUrl ?? undefined} alt="" />
          <AvatarFallback className="bg-primary text-sm text-primary-foreground">
            {getInitials(user)}
          </AvatarFallback>
        </Avatar>
      </motion.div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-base font-semibold">{fullName}</h2>
          <Badge className="h-5 px-1.5 text-[11px]" variant={user.role === 'admin' ? 'default' : 'outline'}>
            {roleLabel ?? user.role}
          </Badge>
          <Badge className="h-5 px-1.5 text-[11px]" variant={user.status === 'active' ? 'secondary' : 'outline'}>
            {user.status}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{identity}</p>
      </div>
    </div>
  );
}

function getInitials(user: UserManagementUser): string {
  const source = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}
