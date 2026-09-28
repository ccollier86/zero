'use client';

import * as React from 'react';
import { CheckCheckIcon } from 'lucide-react';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { Settings } from '#zero/components/animate-ui/icons/settings';
import type { Transition } from 'motion/react';

import { cn } from '#zero/lib/utils';
import { Button } from '#zero/components/ui/button';
import { Separator } from '#zero/components/ui/separator';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#zero/components/animate-ui/components/radix/popover';
import {
  NotificationList,
  type NotificationListItem,
} from '#zero/components/ui/notification-list';

// ─── Types ───────────────────────────────────────────────────────────────

export interface NotificationDropdownProps {
  /** The trigger element (e.g. a bell icon button). */
  children: React.ReactNode;
  /** Notifications to display. */
  items: NotificationListItem[];
  /** Title in the dropdown header. Default: 'Notifications' */
  title?: string;
  /** Called when "Mark all read" is clicked. */
  onMarkAllRead?: () => void;
  /** Called when settings icon is clicked. */
  onSettings?: () => void;
  /** Called when an item is clicked. */
  onItemClick?: (id: string) => void;
  /** Called when an item should be marked read. */
  onItemRead?: (id: string) => void;
  /** Called when an item is dismissed. */
  onItemDismiss?: (id: string) => void;
  /** Called when the dropdown opens. */
  onOpen?: () => void;
  /** Called when the dropdown closes. */
  onClose?: () => void;
  /** Footer content (e.g. "View all" link). */
  footer?: React.ReactNode;
  /** Max list height. Default: '400px' */
  maxHeight?: string;
  /** Group by day. Default: true */
  grouped?: boolean;
  /** Popover width. Default: '380px' */
  width?: string;
  /** Popover alignment. Default: 'end' */
  align?: 'start' | 'center' | 'end';
  /** Popover side offset. Default: 8 */
  sideOffset?: number;
  /** Override popover transition. */
  transition?: Transition;
  /** Extra class on the popover content. */
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────

function NotificationDropdown({
  children,
  items,
  title = 'Notifications',
  onMarkAllRead,
  onSettings,
  onItemClick,
  onItemRead,
  onItemDismiss,
  onOpen,
  onClose,
  footer,
  maxHeight = '400px',
  grouped = true,
  width = '380px',
  align = 'end',
  sideOffset = 8,
  transition,
  className,
}: NotificationDropdownProps) {
  const [open, setOpen] = React.useState(false);

  const handleOpenChange = React.useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (isOpen) {
        onOpen?.();
      } else {
        onClose?.();
      }
    },
    [onOpen, onClose],
  );

  const unreadCount = React.useMemo(
    () => items.filter((i) => !i.read).length,
    [items],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={sideOffset}
        transition={transition}
        className={cn(
          'p-0 overflow-hidden',
          className,
        )}
        style={{ width }}
      >
        {/* Header */}
        <div data-slot="notification-dropdown-header" className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {unreadCount > 0 && (
              <span className="flex items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground tabular-nums">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onMarkAllRead && unreadCount > 0 && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onMarkAllRead}
                title="Mark all as read"
              >
                <CheckCheckIcon className="size-3.5" />
              </Button>
            )}
            {onSettings && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onSettings}
                title="Notification settings"
              >
                <AnimateIcon animateOnHover><Settings size={14} /></AnimateIcon>
              </Button>
            )}
          </div>
        </div>

        <Separator />

        {/* List */}
        <NotificationList
          items={items}
          maxHeight={maxHeight}
          onItemClick={(id) => {
            onItemClick?.(id);
            setOpen(false);
          }}
          onItemRead={onItemRead}
          onItemDismiss={onItemDismiss}
          grouped={grouped}
        />

        {/* Footer */}
        {footer && (
          <>
            <Separator />
            <div data-slot="notification-dropdown-footer" className="px-4 py-2.5">
              {footer}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export { NotificationDropdown };
