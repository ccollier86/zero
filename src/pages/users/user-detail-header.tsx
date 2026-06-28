'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { MockUser } from './mock-users';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UserDetailHeaderProps {
  user: MockUser;
  className?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(timestamp);
}

const ROLE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  provider: 'secondary',
  staff: 'outline',
  viewer: 'outline',
};

// ─── Component ──────────────────────────────────────────────────────────────

function UserDetailHeader({ user, className }: UserDetailHeaderProps) {
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
              {getInitials(user.firstName, user.lastName)}
            </AvatarFallback>
          </Avatar>
        </motion.div>
      </AnimatePresence>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold">{fullName}</h2>
        <p className="truncate text-sm text-muted-foreground">
          @{user.username} &middot; {user.email}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Badge variant={ROLE_VARIANT[user.role] ?? 'outline'}>
            {user.role}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Joined {formatDate(user.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

export { UserDetailHeader };
