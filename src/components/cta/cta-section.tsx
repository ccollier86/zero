/**
 * cta-section.tsx
 *
 * Renders a tokenized public call-to-action section. This file owns CTA
 * presentation only; callers own copy, action destinations, and tracking.
 */

import * as React from 'react';

import { HeroActions } from '@/components/hero';
import { cn } from '@/lib/utils';

import type { CtaSectionProps } from './cta-section.types';

/** Render a compact public call-to-action section with reusable Hero actions. */
export function CtaSection({
  eyebrow,
  title,
  description,
  actions,
  align = 'center',
  framed = true,
  className,
  innerClassName,
  contentClassName,
  actionsClassName,
  ...props
}: CtaSectionProps) {
  const centered = align === 'center';

  return (
    <section
      data-zero-surface="public"
      className={cn('zero-public bg-public-background px-6 py-16 text-public-foreground sm:px-8 lg:px-10', className)}
      {...props}
    >
      <div
        className={cn(
          'relative mx-auto w-full max-w-7xl overflow-hidden rounded-lg',
          framed && 'border border-public-border bg-public-glass shadow-[var(--public-shadow-floating)] backdrop-blur-xl',
          innerClassName,
        )}
      >
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklch,var(--public-accent)_20%,transparent),transparent_34rem)]" />
        <div
          className={cn(
            'mx-auto flex max-w-4xl flex-col px-6 py-14 sm:px-10 lg:px-16 lg:py-16',
            centered ? 'items-center text-center' : 'items-start text-left',
            contentClassName,
          )}
        >
          {eyebrow ? (
            <div className="mb-5 text-sm font-semibold text-public-accent">
              {eyebrow}
            </div>
          ) : null}
          <h2 className="text-balance text-4xl font-semibold leading-tight text-public-foreground sm:text-5xl">
            {title}
          </h2>
          {description ? (
            <p
              className={cn(
                'mt-6 max-w-2xl text-pretty text-lg leading-8 text-public-muted-foreground',
                centered && 'mx-auto',
              )}
            >
              {description}
            </p>
          ) : null}
          <HeroActions
            actions={actions}
            className={cn('mt-8', centered ? 'justify-center' : 'justify-start', actionsClassName)}
          />
        </div>
      </div>
    </section>
  );
}
