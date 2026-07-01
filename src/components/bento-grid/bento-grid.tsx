/**
 * bento-grid.tsx
 *
 * Renders a tokenized public bento grid adapted from the Aceternity layout
 * pattern. This file owns grid and card presentation only; callers own content
 * and responsive placement decisions.
 */

import * as React from 'react';

import { ZeroIcon } from '@/components/animate-ui/icons/zero-icon';
import { cn } from '@/lib/utils';

import type { BentoGridColumns, BentoGridItemProps, BentoGridProps, BentoGridSpan } from './bento-grid.types';

const gridColumnClasses: Record<BentoGridColumns, string> = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
};

const spanClasses: Record<BentoGridSpan, string> = {
  1: '',
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
};

/** Render a responsive public bento grid container. */
export function BentoGrid({ columns = 3, className, children, ...props }: BentoGridProps) {
  return (
    <div
      data-zero-surface="public"
      className={cn(
        'zero-public mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 md:auto-rows-[18rem]',
        gridColumnClasses[columns],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Render one bento grid item with optional header media and icon. */
export function BentoGridItem({
  title,
  description,
  header,
  icon,
  iconName,
  span = 1,
  className,
  children,
  ...props
}: BentoGridItemProps) {
  return (
    <article
      className={cn(
        'group/bento row-span-1 flex flex-col justify-between space-y-4 rounded-lg border border-public-border bg-public-glass p-4 text-public-glass-foreground shadow-[var(--public-shadow-floating)] backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:bg-public-surface hover:shadow-lg',
        spanClasses[span],
        className,
      )}
      {...props}
    >
      {header ?? children}
      {(title || description || icon || iconName) ? (
        <div className="transition duration-200 group-hover/bento:translate-x-1">
          {renderBentoIcon(icon, iconName)}
          {title ? (
            <div className="mt-2 text-base font-semibold leading-6 text-public-foreground">
              {title}
            </div>
          ) : null}
          {description ? (
            <div className="mt-1 text-sm leading-6 text-public-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** Render a tokenized placeholder commonly used as a bento card header. */
export function BentoGridSkeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex min-h-24 flex-1 rounded-lg border border-public-border bg-[linear-gradient(135deg,var(--public-muted),var(--public-surface-raised))]',
        className,
      )}
      {...props}
    />
  );
}

function renderBentoIcon(icon: React.ReactNode, iconName: BentoGridItemProps['iconName']) {
  if (icon) return <div className="text-public-accent">{icon}</div>;
  if (!iconName) return null;
  return <ZeroIcon name={iconName} aria-hidden className="size-4 text-public-accent" />;
}
