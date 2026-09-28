'use client';

import * as React from 'react';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { Bell } from '#zero/components/animate-ui/icons/bell';
import type { Transition } from 'motion/react';

import { cn } from '#zero/lib/utils';
import { Button } from '#zero/components/ui/button';
import { NotificationBadge, type NotificationBadgeProps } from '#zero/components/ui/notification-badge';
import {
  NotificationDropdown,
  type NotificationDropdownProps,
} from '#zero/components/ui/notification-dropdown';
import type { NotificationListItem } from '#zero/components/ui/notification-list';

// ─── Types ───────────────────────────────────────────────────────────────

export interface NotificationCenterProps {
  /** Notification items to display. */
  items: NotificationListItem[];
  /** Called when "Mark all read" is clicked. */
  onMarkAllRead?: () => void;
  /** Called when the dropdown opens — use to mark all as seen. */
  onOpen?: () => void;
  /** Called when the dropdown closes. */
  onClose?: () => void;
  /** Called when an item is clicked. */
  onItemClick?: (id: string) => void;
  /** Called when an item should be marked read. */
  onItemRead?: (id: string) => void;
  /** Called when an item is dismissed. */
  onItemDismiss?: (id: string) => void;
  /** Called when settings icon is clicked. */
  onSettings?: () => void;
  /** Header title. Default: 'Notifications' */
  title?: string;
  /** Footer content. */
  footer?: React.ReactNode;
  /** Custom trigger element. Overrides the default bell button. */
  trigger?: React.ReactNode;
  /** Bell button variant. Default: 'ghost' */
  buttonVariant?: 'ghost' | 'outline' | 'secondary';
  /** Bell button size. Default: 'icon' */
  buttonSize?: 'icon' | 'icon-sm' | 'icon-xs';
  /** Badge variant. Default: 'destructive' */
  badgeVariant?: NotificationBadgeProps['variant'];
  /** Show pulse on badge. Default: false */
  badgePulse?: boolean;
  /** Show dot instead of count. Default: false */
  badgeDot?: boolean;
  /** Use unseen count for badge instead of unread. */
  badgeCount?: number;
  /** Max height of the notification list. */
  maxHeight?: string;
  /** Group by day. Default: true */
  grouped?: boolean;
  /** Popover alignment. Default: 'end' */
  align?: 'start' | 'center' | 'end';
  /** Override popover transition. */
  transition?: Transition;
  /** Extra class on the bell button. */
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────

function NotificationCenter({
  items,
  onMarkAllRead,
  onOpen,
  onClose,
  onItemClick,
  onItemRead,
  onItemDismiss,
  onSettings,
  title,
  footer,
  trigger,
  buttonVariant = 'ghost',
  buttonSize = 'icon',
  badgeVariant = 'destructive',
  badgePulse = false,
  badgeDot = false,
  badgeCount,
  maxHeight,
  grouped,
  align = 'end',
  transition,
  className,
}: NotificationCenterProps) {
  const unreadCount = badgeCount ?? items.filter((i) => !i.read).length;

  const bellTrigger = trigger ?? (
    <Button
      data-slot="notification-center-trigger"
      variant={buttonVariant}
      size={buttonSize}
      className={cn('relative', className)}
      aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
    >
      <NotificationBadge
        count={unreadCount}
        variant={badgeVariant}
        pulse={badgePulse}
        dot={badgeDot}
      >
        <AnimateIcon animateOnHover>
          <Bell size={16} />
        </AnimateIcon>
      </NotificationBadge>
    </Button>
  );

  return (
    <NotificationDropdown
      items={items}
      title={title}
      onMarkAllRead={onMarkAllRead}
      onOpen={onOpen}
      onClose={onClose}
      onItemClick={onItemClick}
      onItemRead={onItemRead}
      onItemDismiss={onItemDismiss}
      onSettings={onSettings}
      footer={footer}
      maxHeight={maxHeight}
      grouped={grouped}
      align={align}
      transition={transition}
    >
      {bellTrigger}
    </NotificationDropdown>
  );
}

export { NotificationCenter };
