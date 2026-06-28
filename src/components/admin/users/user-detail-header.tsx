'use client';

/**
 * user-detail-header.tsx
 *
 * Renders the selected user's compact detail header for the reusable admin
 * user-management organism. This file owns presentation only; user mutations
 * and auth policy live in sibling hook/component files.
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Avatar, AvatarFallback } from '../../ui/avatar';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import type { UserManagementUser } from './user-management-types';

export interface UserDetailHeaderProps {
  user: UserManagementUser;
  className?: string;
}

/** Render the selected user's avatar, name, email, role, and join date. */
export function UserDetailHeader({ user, className }: UserDetailHeaderProps) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <AnimatePresence mode="wait">
        <motion.div
          key={user.id}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          <Avatar className="size-16">
            <AvatarFallback className="bg-primary text-primary-foreground text-lg">
              {getInitials(user)}
            </AvatarFallback>
          </Avatar>
        </motion.div>
      </AnimatePresence>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold">{fullName}</h2>
        <p className="truncate text-sm text-muted-foreground">
          @{user.username} &middot; {user.email}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge variant={user.role === 'admin' ? 'default' : 'outline'}>
            {user.role}
          </Badge>
          <Badge variant={user.status === 'active' ? 'secondary' : 'outline'}>
            {user.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Joined {formatDate(user.createdAt)}
          </span>
        </div>
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

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
  }).format(timestamp);
}
