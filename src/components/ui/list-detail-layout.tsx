'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Separator } from '#zero/components/ui/separator';
import { cn } from '#zero/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ListDetailLayoutProps {
  /** Left panel content (DataTable, list, etc.) */
  list: React.ReactNode;
  /** Right panel content (detail view, form, etc.) */
  detail: React.ReactNode;
  /** Bottom bar content (navigation bar, actions, etc.) */
  bottomBar?: React.ReactNode;
  /** Whether a record is selected (controls detail panel visibility on mobile) */
  hasSelection?: boolean;
  /** Key for the selected record — triggers crossfade animation on change */
  selectedKey?: string;
  /** Width ratio for list panel. Default: '3fr' */
  listWidth?: string;
  /** Width ratio for detail panel. Default: '2fr' */
  detailWidth?: string;
  className?: string;
}

// ─── Animation ──────────────────────────────────────────────────────────────

const detailVariants = {
  initial: { opacity: 0, x: 20 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 25 },
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: { duration: 0.15 },
  },
};

const mobileDetailVariants = {
  initial: { opacity: 0, y: 40 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 150, damping: 22 },
  },
  exit: {
    opacity: 0,
    y: 40,
    transition: { duration: 0.15 },
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

function ListDetailLayout({
  list,
  detail,
  bottomBar,
  hasSelection = false,
  selectedKey,
  listWidth = '3fr',
  detailWidth = '2fr',
  className,
}: ListDetailLayoutProps) {
  return (
    <div
      data-slot="list-detail-layout"
      className={cn('flex h-full flex-col', className)}
    >
      {/* Main content area */}
      <div
        className="hidden min-h-0 flex-1 md:grid"
        style={{ gridTemplateColumns: `${listWidth} auto ${detailWidth}` }}
      >
        {/* List panel */}
        <div className="min-h-0 overflow-auto">{list}</div>

        {/* Vertical separator */}
        <Separator orientation="vertical" />

        {/* Detail panel */}
        <div className="relative min-h-0 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedKey ?? '__empty'}
              variants={detailVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="h-full"
            >
              {detail}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Mobile: stacked layout */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <div className={cn('min-h-0 flex-1 overflow-auto', hasSelection && 'hidden')}>
          {list}
        </div>
        <AnimatePresence>
          {hasSelection && (
            <motion.div
              variants={mobileDetailVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="min-h-0 flex-1 overflow-hidden"
            >
              {detail}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom bar */}
      {bottomBar && (
        <div className="shrink-0 border-t border-border">{bottomBar}</div>
      )}
    </div>
  );
}

export { ListDetailLayout };
