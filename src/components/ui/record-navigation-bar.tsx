'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, type Variants, type Transition } from 'motion/react';
import { SlidingNumber } from '#zero/components/animate-ui/primitives/texts/sliding-number';
import { cn } from '#zero/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NavigationAction {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'destructive' | 'success' | 'warning';
  disabled?: boolean;
}

export interface RecordNavigationBarProps {
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  actions?: NavigationAction[];
  primaryAction?: {
    label: string;
    sublabel?: string;
    shortcut?: string;
    disabled?: boolean;
    onClick: () => void;
  };
  className?: string;
}

// ─── Animation Config (ManagementBar DNA) ────────────────────────────────────

const BUTTON_MOTION_CONFIG = {
  initial: 'rest',
  whileHover: 'hover',
  whileTap: 'tap',
  variants: {
    rest: { maxWidth: '40px' },
    hover: {
      maxWidth: '140px',
      transition: { type: 'spring', stiffness: 200, damping: 35, delay: 0.15 },
    },
    tap: { scale: 0.95 },
  },
  transition: { type: 'spring', stiffness: 250, damping: 25 },
} as const;

const LABEL_VARIANTS: Variants = {
  rest: { opacity: 0, x: 4 },
  hover: { opacity: 1, x: 0, visibility: 'visible' },
  tap: { opacity: 1, x: 0, visibility: 'visible' },
};

const LABEL_TRANSITION: Transition = {
  type: 'spring',
  stiffness: 200,
  damping: 25,
};

const VARIANT_COLORS: Record<string, string> = {
  default: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/15',
  success: 'bg-success/10 text-success hover:bg-success/15',
  warning: 'bg-warning/10 text-warning hover:bg-warning/15',
};

// ─── Component ──────────────────────────────────────────────────────────────

function RecordNavigationBar({
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
  actions,
  primaryAction,
  className,
}: RecordNavigationBarProps) {
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= totalCount - 1;
  const displayIndex = totalCount > 0 ? currentIndex + 1 : 0;

  return (
    <div
      data-slot="record-navigation-bar"
      className={cn('@container/wrapper w-full flex justify-center', className)}
    >
      <div className="flex w-full flex-col @xl/wrapper:flex-row items-center gap-y-2 rounded-2xl border border-border bg-background p-2 shadow-lg">
        {/* Navigation controls */}
        <div className="flex shrink-0 items-center">
          <div className="flex h-10 items-center">
            <button
              disabled={isFirst}
              className="p-1 text-muted-foreground transition-colors hover:text-foreground disabled:text-muted-foreground/30"
              onClick={onPrevious}
              aria-label="Previous record"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="mx-2 flex items-center space-x-1 text-sm tabular-nums">
              <SlidingNumber
                className="text-foreground"
                padStart
                number={displayIndex}
              />
              <span className="text-muted-foreground">/ {totalCount}</span>
            </div>
            <button
              disabled={isLast}
              className="p-1 text-muted-foreground transition-colors hover:text-foreground disabled:text-muted-foreground/30"
              onClick={onNext}
              aria-label="Next record"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Action buttons */}
          {actions && actions.length > 0 && (
            <>
              <div className="mx-3 h-6 w-px bg-border rounded-full hidden @lg/wrapper:block" />
              <motion.div layout layoutRoot className="mx-auto flex flex-wrap space-x-2 sm:flex-nowrap">
                {actions.map((action) => (
                  <motion.button
                    key={action.label}
                    {...BUTTON_MOTION_CONFIG}
                    disabled={action.disabled}
                    className={cn(
                      'flex h-10 items-center space-x-2 overflow-hidden whitespace-nowrap rounded-lg px-2.5 py-2 disabled:opacity-50',
                      VARIANT_COLORS[action.variant ?? 'default'],
                    )}
                    aria-label={action.label}
                    onClick={action.onClick}
                  >
                    <span className="shrink-0">{action.icon}</span>
                    <motion.span
                      variants={LABEL_VARIANTS}
                      transition={LABEL_TRANSITION}
                      className="invisible text-sm"
                    >
                      {action.label}
                    </motion.span>
                  </motion.button>
                ))}
              </motion.div>
            </>
          )}
        </div>

        {/* Primary action */}
        {primaryAction && (
          <>
            <div className="mx-3 hidden h-6 w-px bg-border @xl/wrapper:block rounded-full" />
            <motion.button
              whileTap={{ scale: 0.975 }}
              disabled={primaryAction.disabled}
              className="flex h-10 text-sm cursor-pointer items-center justify-center rounded-lg bg-primary px-3 py-2 text-primary-foreground transition-colors duration-300 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 w-full @xl/wrapper:w-auto"
              onClick={primaryAction.onClick}
            >
              {primaryAction.sublabel && (
                <span className="mr-1 text-primary-foreground/80">{primaryAction.sublabel}</span>
              )}
              <span>{primaryAction.label}</span>
              {primaryAction.shortcut && (
                <>
                  <div className="mx-3 h-5 w-px bg-primary-foreground/40 rounded-full" />
                  <div className="flex items-center gap-1 rounded-md bg-primary-foreground/20 px-1.5 py-0.5 -mr-1 text-xs">
                    {primaryAction.shortcut}
                  </div>
                </>
              )}
            </motion.button>
          </>
        )}
      </div>
    </div>
  );
}

export { RecordNavigationBar };
