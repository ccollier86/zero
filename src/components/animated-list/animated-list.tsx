'use client';

/**
 * animated-list.tsx
 *
 * Renders a Magic UI style sequenced animated list using Zero tokens. This file
 * owns timed child reveal and the optional event-card skin only; callers own
 * data sources, routing, and list semantics.
 */

import * as React from 'react';
import { AnimatePresence, motion, type MotionProps } from 'motion/react';

import { ZeroIcon } from '@/components/animate-ui/icons/zero-icon';
import { cn } from '@/lib/utils';

import type { AnimatedListCardProps, AnimatedListItemProps, AnimatedListProps } from './animated-list.types';

const itemAnimations: MotionProps = {
  initial: { scale: 0, opacity: 0 },
  animate: { scale: 1, opacity: 1, originY: 0 },
  exit: { scale: 0, opacity: 0 },
  transition: { type: 'spring', stiffness: 350, damping: 40 },
};

/** Render one animated-list child with the spring animation used by Magic UI. */
export function AnimatedListItem({ children }: AnimatedListItemProps) {
  return (
    <motion.div {...itemAnimations} layout className="mx-auto w-full">
      {children}
    </motion.div>
  );
}

/** Reveal children one at a time, newest first, using a configurable delay. */
export const AnimatedList = React.memo(function AnimatedList({
  children,
  className,
  delay = 1000,
  ...props
}: AnimatedListProps) {
  const [index, setIndex] = React.useState(0);
  const childrenArray = React.useMemo(() => React.Children.toArray(children), [children]);

  React.useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    if (index < childrenArray.length - 1) {
      timeout = setTimeout(() => {
        setIndex((previousIndex) => (previousIndex + 1) % childrenArray.length);
      }, delay);
    }

    return () => {
      if (timeout !== null) clearTimeout(timeout);
    };
  }, [index, delay, childrenArray.length]);

  React.useEffect(() => {
    setIndex(0);
  }, [childrenArray.length]);

  const itemsToShow = React.useMemo(
    () => childrenArray.slice(0, index + 1).reverse(),
    [childrenArray, index],
  );

  return (
    <div
      data-zero-surface="public"
      className={cn('zero-public flex flex-col items-center gap-4', className)}
      {...props}
    >
      <AnimatePresence>
        {itemsToShow.map((item, itemIndex) => (
          <AnimatedListItem key={(item as React.ReactElement).key ?? itemIndex}>
            {item}
          </AnimatedListItem>
        ))}
      </AnimatePresence>
    </div>
  );
});

/** Render a tokenized event card that pairs naturally with AnimatedList. */
export function AnimatedListCard({
  title,
  description,
  meta,
  icon,
  iconName = 'bell',
  color = 'var(--public-accent)',
  className,
  ...props
}: AnimatedListCardProps) {
  return (
    <figure
      className={cn(
        'relative mx-auto min-h-fit w-full max-w-[25rem] overflow-hidden rounded-lg border border-public-border bg-public-glass p-4 text-public-glass-foreground shadow-[var(--public-shadow-floating)] backdrop-blur-xl transition-all duration-200 ease-in-out hover:scale-[1.02]',
        className,
      )}
      {...props}
    >
      <div className="flex flex-row items-center gap-3">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-public-accent-foreground"
          style={{ backgroundColor: color }}
        >
          {icon ?? <ZeroIcon name={iconName} aria-hidden className="size-5" />}
        </div>
        <figcaption className="min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-sm font-semibold text-public-foreground">
            <span className="truncate">{title}</span>
            {meta ? (
              <>
                <span className="text-public-muted-foreground">·</span>
                <span className="text-xs font-normal text-public-muted-foreground">{meta}</span>
              </>
            ) : null}
          </div>
          {description ? (
            <p className="mt-0.5 truncate text-sm text-public-muted-foreground">
              {description}
            </p>
          ) : null}
        </figcaption>
      </div>
    </figure>
  );
}
