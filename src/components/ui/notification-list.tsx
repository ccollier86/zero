'use client';

import * as React from 'react';
import { InboxIcon } from 'lucide-react';
import { AnimatePresence } from 'motion/react';

import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  NotificationItem,
  type NotificationItemProps,
  type NotificationItemType,
} from '@/components/ui/notification-item';

// ─── Types ───────────────────────────────────────────────────────────────

export interface NotificationListItem {
  id: string;
  type?: NotificationItemType;
  title: string;
  body?: string | null;
  timestamp: number;
  read?: boolean;
  actionUrl?: string | null;
  avatarUrl?: string | null;
  avatarFallback?: string;
}

export interface NotificationListProps {
  /** Notification items to display. */
  items: NotificationListItem[];
  /** Max height before scrolling. Default: '400px' */
  maxHeight?: string;
  /** Called when an item is clicked. */
  onItemClick?: (id: string) => void;
  /** Called when an item should be marked read. */
  onItemRead?: (id: string) => void;
  /** Called when an item is dismissed. */
  onItemDismiss?: (id: string) => void;
  /** Group notifications by day (today / earlier). Default: true */
  grouped?: boolean;
  /** Message when list is empty. */
  emptyMessage?: string;
  /** Icon for empty state. */
  emptyIcon?: React.ReactNode;
  /** Extra class on the container. */
  className?: string;
  /** Props forwarded to each NotificationItem. */
  itemClassName?: string;
}

// ─── Grouping Helper ─────────────────────────────────────────────────────

function groupByDay(
  items: NotificationListItem[],
): { label: string; items: NotificationListItem[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;

  const groups: Map<string, NotificationListItem[]> = new Map();

  for (const item of items) {
    let label: string;
    if (item.timestamp >= todayStart) {
      label = 'Today';
    } else if (item.timestamp >= yesterdayStart) {
      label = 'Yesterday';
    } else {
      label = 'Earlier';
    }

    const group = groups.get(label);
    if (group) {
      group.push(item);
    } else {
      groups.set(label, [item]);
    }
  }

  // Maintain order: Today → Yesterday → Earlier
  const result: { label: string; items: NotificationListItem[] }[] = [];
  for (const label of ['Today', 'Yesterday', 'Earlier']) {
    const items = groups.get(label);
    if (items?.length) {
      result.push({ label, items });
    }
  }
  return result;
}

// ─── Component ───────────────────────────────────────────────────────────

function NotificationList({
  items,
  maxHeight = '400px',
  onItemClick,
  onItemRead,
  onItemDismiss,
  grouped = true,
  emptyMessage = 'No notifications',
  emptyIcon,
  className,
  itemClassName,
}: NotificationListProps) {
  if (items.length === 0) {
    return (
      <div
        data-slot="notification-list-empty"
        className={cn(
          'flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground',
          className,
        )}
      >
        {emptyIcon ?? <InboxIcon className="size-10 opacity-30" />}
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  const renderItem = (item: NotificationListItem) => (
    <NotificationItem
      key={item.id}
      id={item.id}
      type={item.type}
      title={item.title}
      body={item.body}
      timestamp={item.timestamp}
      read={item.read}
      actionUrl={item.actionUrl}
      avatarUrl={item.avatarUrl}
      avatarFallback={item.avatarFallback}
      onClick={onItemClick}
      onRead={onItemRead}
      onDismiss={onItemDismiss}
      className={itemClassName}
    />
  );

  const content = grouped ? (
    groupByDay(items).map(({ label, items: groupItems }) => (
      <div key={label} className="space-y-1">
        <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
          {label}
        </p>
        <AnimatePresence mode="popLayout">
          {groupItems.map(renderItem)}
        </AnimatePresence>
      </div>
    ))
  ) : (
    <AnimatePresence mode="popLayout">
      {items.map(renderItem)}
    </AnimatePresence>
  );

  return (
    <ScrollArea
      data-slot="notification-list"
      className={cn('w-full', className)}
      style={{ maxHeight }}
    >
      <div className="flex flex-col gap-0.5 p-1">
        {content}
      </div>
    </ScrollArea>
  );
}

export { NotificationList };
