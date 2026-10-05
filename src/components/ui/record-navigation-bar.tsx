'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
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

export interface RecordPrimaryAction {
  label: string;
  sublabel?: string;
  shortcut?: string;
  disabled?: boolean;
  ariaHasPopup?: React.AriaAttributes['aria-haspopup'];
  onClick: () => void;
}

export interface RecordNavigationBarProps {
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  /** Hide record previous/next/count without hiding actions. Default: true. */
  showNavigation?: boolean;
  /** Optional useful scope/count status; independent from record navigation. */
  status?: React.ReactNode;
  actions?: NavigationAction[];
  /** Optional adjacent workflow rendered before the primary action. */
  secondaryPrimaryAction?: RecordPrimaryAction;
  primaryAction?: RecordPrimaryAction;
  className?: string;
}

// ─── Animation Config (ManagementBar DNA) ────────────────────────────────────

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
  showNavigation = true,
  status,
  actions,
  secondaryPrimaryAction,
  primaryAction,
  className,
}: RecordNavigationBarProps) {
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= totalCount - 1;
  const displayIndex = totalCount > 0 ? currentIndex + 1 : 0;

  return (
    <div
      data-slot="record-navigation-bar"
      className={cn('@container/wrapper flex w-full justify-center', className)}
    >
      <div className="flex w-full min-w-0 flex-col items-stretch gap-2 rounded-2xl border border-border bg-background p-2 shadow-lg @xl/wrapper:flex-row @xl/wrapper:items-center">
        <div className="flex min-w-0 w-full flex-row items-center gap-2 @xl/wrapper:flex-1">
          {/* Navigation controls */}
          {(showNavigation || status != null) && <div className="flex h-10 min-w-0 shrink-0 items-center gap-2">
            {showNavigation && <>
            <button
              type="button"
              disabled={isFirst}
              className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:text-muted-foreground/30"
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
              type="button"
              disabled={isLast}
              className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:text-muted-foreground/30"
              onClick={onNext}
              aria-label="Next record"
            >
              <ChevronRight size={20} />
            </button>
            </>}
            {status != null && <div role="status" className="max-w-40 truncate text-xs text-muted-foreground">{status}</div>}
          </div>}

          {/* Record action buttons */}
          {actions && actions.length > 0 && (
            <>
              <div className="hidden h-6 w-px shrink-0 rounded-full bg-border @sm/wrapper:block" />
              <motion.div
                layout
                layoutRoot
                className="flex min-w-0 flex-1 flex-nowrap items-center justify-start gap-2 overflow-x-auto py-1"
              >
                {actions.map((action, index) => (
                  <motion.button
                    key={`${action.label}:${index}`}
                    type="button"
                    whileTap={{ scale: 0.95 }}
                    disabled={action.disabled}
                    className={cn(
                      'flex h-10 max-w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 transition-[background-color,color,box-shadow,opacity] duration-200 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
                      VARIANT_COLORS[action.variant ?? 'default'],
                    )}
                    aria-label={action.label}
                    onClick={action.onClick}
                  >
                    <span className="shrink-0">{action.icon}</span>
                    <span className="text-sm">
                      {action.label}
                    </span>
                  </motion.button>
                ))}
              </motion.div>
            </>
          )}
        </div>

        {/* Primary workflows */}
        {(secondaryPrimaryAction || primaryAction) && (
          <>
            <div className="hidden h-6 w-px shrink-0 rounded-full bg-border @xl/wrapper:block" />
            <div className="flex w-full min-w-0 flex-row gap-2 @xl/wrapper:w-auto @xl/wrapper:shrink-0">
              {secondaryPrimaryAction && (
                <PrimaryActionButton action={secondaryPrimaryAction} secondary />
              )}
              {primaryAction && <PrimaryActionButton action={primaryAction} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { RecordNavigationBar };

function PrimaryActionButton({
  action,
  secondary = false,
}: {
  action: RecordPrimaryAction;
  secondary?: boolean;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.975 }}
      disabled={action.disabled}
      aria-haspopup={action.ariaHasPopup}
      className={cn(
        'flex h-10 min-w-0 max-w-full flex-1 cursor-pointer items-center justify-center rounded-lg px-3 py-2 text-sm transition-colors duration-300 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 @xl/wrapper:w-auto @xl/wrapper:flex-none',
        secondary
          ? 'border border-border bg-background text-foreground hover:bg-accent'
          : 'bg-primary text-primary-foreground hover:bg-primary/90',
      )}
      onClick={action.onClick}
    >
      {action.sublabel && (
        <span className={cn('mr-1', secondary ? 'text-muted-foreground' : 'text-primary-foreground/80')}>
          {action.sublabel}
        </span>
      )}
      <span className="min-w-0 truncate">{action.label}</span>
      {action.shortcut && (
        <>
          <div className={cn('mx-3 hidden h-5 w-px shrink-0 rounded-full @sm/wrapper:block', secondary ? 'bg-border' : 'bg-primary-foreground/40')} />
          <div className={cn(
            '-mr-1 hidden shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs @sm/wrapper:flex',
            secondary ? 'bg-muted' : 'bg-primary-foreground/20',
          )}>
            {action.shortcut}
          </div>
        </>
      )}
    </motion.button>
  );
}
