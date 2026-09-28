'use client';

/**
 * features-section.tsx
 *
 * Renders Zero's public feature showcase section. This file owns feature-list
 * layout and tokenized visual framing only; callers own copy, links, and the
 * visual content supplied to the section.
 */

import * as React from 'react';

import { AnimateIcon } from '#zero/components/animate-ui/icons';
import { ZeroIcon } from '#zero/components/animate-ui/icons/zero-icon';
import { cn } from '#zero/lib/utils';

import type { FeatureSectionItem, FeaturesSectionProps } from './features-section.types';

/** Render a public landing/docs feature section with an optional visual slot. */
export function FeaturesSection({
  eyebrow,
  title,
  description,
  features = [],
  visual,
  visualPosition = 'right',
  titleAs = 'h2',
  framed = true,
  className,
  innerClassName,
  contentClassName,
  featureListClassName,
  visualClassName,
  ...props
}: FeaturesSectionProps) {
  const Title = titleAs;
  const content = (
    <div className={cn('flex min-w-0 flex-col justify-center', contentClassName)}>
      {eyebrow ? (
        <div className="mb-5 text-sm font-semibold text-public-accent">
          {eyebrow}
        </div>
      ) : null}
      <Title className="max-w-2xl text-balance text-4xl font-semibold leading-tight text-public-foreground sm:text-5xl">
        {title}
      </Title>
      {description ? (
        <div className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-public-muted-foreground">
          {description}
        </div>
      ) : null}
      {features.length > 0 ? (
        <div className={cn('mt-10 grid gap-7', featureListClassName)}>
          {features.map((feature) => (
            <FeatureSectionBullet key={feature.id} feature={feature} />
          ))}
        </div>
      ) : null}
    </div>
  );
  const visualNode = visual ? (
    <div className={cn('relative min-w-0', visualClassName)}>
      <div className="absolute inset-0 -z-10 translate-x-4 translate-y-4 rounded-lg bg-public-accent opacity-20 blur-2xl" />
      {visual}
    </div>
  ) : null;

  return (
    <section
      data-zero-surface="public"
      className={cn('zero-public bg-public-background py-24 sm:py-28', className)}
      {...props}
    >
      <div
        className={cn(
          'mx-auto grid w-full max-w-7xl gap-12 px-6 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:px-10',
          framed && 'rounded-lg border border-public-border bg-public-glass py-10 shadow-[var(--public-shadow-floating)] backdrop-blur-xl sm:px-10 lg:p-12',
          visualPosition === 'left' && 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]',
          !visual && 'lg:grid-cols-1',
          innerClassName,
        )}
      >
        {visualPosition === 'left' ? (
          <>
            {visualNode}
            {content}
          </>
        ) : (
          <>
            {content}
            {visualNode}
          </>
        )}
      </div>
    </section>
  );
}

function FeatureSectionBullet({ feature }: { feature: FeatureSectionItem }) {
  return (
    <AnimateIcon
      animateOnHover
      completeOnStop
      asChild
      className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-4"
    >
      <div>
        <span className="mt-1 flex size-9 items-center justify-center rounded-md border border-public-border bg-public-surface text-public-accent shadow-sm">
          {renderFeatureIcon(feature)}
        </span>
        <div className="min-w-0">
          <div className="text-base font-semibold leading-7 text-public-foreground">
            {feature.title}
          </div>
          {feature.description ? (
            <div className="mt-1 text-base leading-7 text-public-muted-foreground">
              {feature.description}
            </div>
          ) : null}
        </div>
      </div>
    </AnimateIcon>
  );
}

function renderFeatureIcon(feature: FeatureSectionItem) {
  if (feature.icon) return feature.icon;
  return (
    <ZeroIcon
      name={feature.iconName ?? 'check'}
      className="size-4"
      aria-hidden
    />
  );
}
