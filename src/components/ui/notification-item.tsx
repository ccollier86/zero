'use client';

import * as React from 'react';
import {
  InfoIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  XCircleIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-react';
import { motion, type HTMLMotionProps } from 'motion/react';

import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────

export type NotificationItemType = 'info' | 'warning' | 'success' | 'error' | 'system';

export interface NotificationItemProps {
  /** Unique notification id. */
  id: string;
  /** Notification type — controls icon and accent color. */
  type?: NotificationItemType;
  /** Title text. */
  title: string;
  /** Body text (optional). */
  body?: string | null;
  /** Timestamp (epoch ms). */
  timestamp: number;
  /** Whether this notification has been read. */
  read?: boolean;
  /** URL to navigate to on click. */
  actionUrl?: string | null;
  /** Avatar URL for sender. */
  avatarUrl?: string | null;
  /** Avatar fallback text (initials). */
  avatarFallback?: string;
  /** Callback when clicked (not dismiss). */
  onClick?: (id: string) => void;
  /** Callback to mark as read. */
  onRead?: (id: string) => void;
  /** Callback to dismiss/remove. */
  onDismiss?: (id: string) => void;
  /** Extra class names. */
  className?: string;
  /** Motion props override for AnimatePresence. */
  motionProps?: HTMLMotionProps<'div'>;
}

// ─── Type Config ─────────────────────────────────────────────────────────

const typeConfig: Record<NotificationItemType, {
  icon: React.ElementType;
  accent: string;
  iconClass: string;
}> = {
  info: {
    icon: InfoIcon,
    accent: 'border-l-blue-500',
    iconClass: 'text-blue-500',
  },
  warning: {
    icon: AlertTriangleIcon,
    accent: 'border-l-amber-500',
    iconClass: 'text-amber-500',
  },
  success: {
    icon: CheckCircle2Icon,
    accent: 'border-l-emerald-500',
    iconClass: 'text-emerald-500',
  },
  error: {
    icon: XCircleIcon,
    accent: 'border-l-destructive',
    iconClass: 'text-destructive',
  },
  system: {
    icon: SettingsIcon,
    accent: 'border-l-muted-foreground',
    iconClass: 'text-muted-foreground',
  },
};

// ─── Time Formatting ─────────────────────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ─── Component ───────────────────────────────────────────────────────────

const NotificationItem = React.forwardRef<HTMLDivElement, NotificationItemProps>(
  function NotificationItem(
    {
      id,
      type = 'info',
      title,
      body,
      timestamp,
      read = false,
      actionUrl,
      avatarUrl,
      avatarFallback,
      onClick,
      onRead,
      onDismiss,
      className,
      motionProps,
    },
    ref,
  ) {
    const config = typeConfig[type];
    const Icon = config.icon;

    const handleClick = React.useCallback(() => {
      if (!read) onRead?.(id);
      onClick?.(id);
      if (actionUrl) {
        window.open(actionUrl, '_blank', 'noopener');
      }
    }, [id, read, onClick, onRead, actionUrl]);

    const handleDismiss = React.useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onDismiss?.(id);
      },
      [id, onDismiss],
    );

    return (
      <motion.div
        ref={ref}
        data-slot="notification-item"
        data-read={read}
        layout
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        {...motionProps}
        className={cn(
          'group relative flex items-start gap-3 rounded-md border-l-2 px-3 py-2.5 transition-colors cursor-pointer',
          config.accent,
          read
            ? 'bg-transparent hover:bg-accent/50'
            : 'bg-accent/30 hover:bg-accent/50',
          className,
        )}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        {/* Avatar or Type Icon */}
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="mt-0.5 size-6 shrink-0 rounded-full object-cover"
          />
        ) : avatarFallback ? (
          <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
            {avatarFallback}
          </div>
        ) : (
          <div className={cn('mt-0.5 shrink-0', config.iconClass)}>
            <Icon className="size-4" />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <p className={cn(
              'text-sm truncate',
              !read && 'font-medium',
            )}>
              {title}
            </p>
            {!read && (
              <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            )}
          </div>
          {body && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {body}
            </p>
          )}
          <p className="text-xs text-muted-foreground/70">
            {formatRelativeTime(timestamp)}
          </p>
        </div>

        {/* Dismiss */}
        {onDismiss && (
          <button
            type="button"
            onClick={handleDismiss}
            className="shrink-0 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent"
            aria-label="Dismiss notification"
          >
            <XIcon className="size-3.5 text-muted-foreground" />
          </button>
        )}
      </motion.div>
    );
  },
);

export { NotificationItem, formatRelativeTime };
