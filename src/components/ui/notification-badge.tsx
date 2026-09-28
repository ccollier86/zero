'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { cn } from '#zero/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────

export interface NotificationBadgeProps {
  /** Number to display. Hidden when 0 or undefined. */
  count?: number;
  /** Max number before showing "N+". Default: 99 */
  max?: number;
  /** Show a dot instead of a number. */
  dot?: boolean;
  /** Badge color variant. */
  variant?: 'default' | 'destructive' | 'warning' | 'success';
  /** Pulse animation for urgency. */
  pulse?: boolean;
  /** Additional class names for the badge element. */
  className?: string;
  /** Position relative to parent. Default: 'top-right' */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  /** Children to wrap (the badge overlays this element). */
  children?: React.ReactNode;
}

// ─── Variant Styles ──────────────────────────────────────────────────────

const variantStyles = {
  default: 'bg-primary text-primary-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  warning: 'bg-amber-500 text-foreground',
  success: 'bg-emerald-500 text-foreground',
} as const;

const positionStyles = {
  'top-right': '-top-1 -right-1',
  'top-left': '-top-1 -left-1',
  'bottom-right': '-bottom-1 -right-1',
  'bottom-left': '-bottom-1 -left-1',
} as const;

// ─── Component ───────────────────────────────────────────────────────────

function NotificationBadge({
  count,
  max = 99,
  dot = false,
  variant = 'destructive',
  pulse = false,
  className,
  position = 'top-right',
  children,
}: NotificationBadgeProps) {
  const show = (count ?? 0) > 0;
  const displayCount = count != null && count > max ? `${max}+` : count;

  const badge = (
    <AnimatePresence mode="wait">
      {show && (
        <motion.span
          key={dot ? 'dot' : `count-${displayCount}`}
          data-slot="notification-badge"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className={cn(
            'pointer-events-none absolute z-10 flex items-center justify-center rounded-full font-semibold tabular-nums',
            dot
              ? 'size-2.5'
              : 'min-w-[18px] h-[18px] px-1 text-[10px] leading-none',
            variantStyles[variant],
            positionStyles[position],
            className,
          )}
        >
          {!dot && displayCount}
          {pulse && (
            <span
              className={cn(
                'absolute inset-0 rounded-full animate-ping opacity-75',
                variantStyles[variant],
              )}
            />
          )}
        </motion.span>
      )}
    </AnimatePresence>
  );

  if (!children) {
    return badge;
  }

  return (
    <span className="relative inline-flex">
      {children}
      {badge}
    </span>
  );
}

export { NotificationBadge };
