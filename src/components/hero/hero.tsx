'use client';

/**
 * hero.tsx
 *
 * Renders Zero's public-page Hero section. This file owns Hero content
 * structure and layout only; background rendering, action buttons, routing,
 * and future text effects live behind explicit slots or helper modules.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';
import { HeroActions } from './hero-actions';
import { HeroBackground } from './hero-background';
import type { HeroBackgroundOptions, HeroProps } from './hero.types';

const SIZE_CLASSES = {
  compact: 'min-h-[32rem] py-28 sm:py-32',
  default: 'min-h-[44rem] py-32 sm:py-40 lg:py-48',
  full: 'min-h-svh py-32 sm:py-40 lg:py-48',
} satisfies Record<NonNullable<HeroProps['size']>, string>;

/**
 * Render a full-bleed public Hero with optional background, eyebrow, rich title,
 * description, actions, and extra child content.
 */
export function Hero({
  eyebrow,
  title,
  description,
  actions,
  children,
  background = { preset: 'aurora' },
  align = 'center',
  size = 'default',
  as = 'section',
  titleAs = 'h1',
  className,
  innerClassName,
  contentClassName,
  eyebrowClassName,
  titleClassName,
  descriptionClassName,
  actionsClassName,
}: HeroProps) {
  const Root = as;
  const Title = titleAs;
  const backgroundOptions = normalizeHeroBackground(background);
  const isCentered = align === 'center';

  return (
    <Root
      data-zero-surface="public"
      className={cn(
        'relative isolate flex overflow-hidden bg-public-background text-public-foreground',
        SIZE_CLASSES[size],
        className,
      )}
    >
      <HeroBackground {...backgroundOptions} />
      <div
        className={cn(
          'mx-auto flex w-full max-w-7xl px-6 sm:px-8 lg:px-10',
          isCentered ? 'items-center justify-center' : 'items-center justify-start',
          innerClassName,
        )}
      >
        <div
          className={cn(
            'flex max-w-4xl flex-col gap-7',
            isCentered ? 'items-center text-center' : 'items-start text-left',
            contentClassName,
          )}
        >
          {eyebrow && (
            <div
              className={cn(
                'inline-flex max-w-full items-center gap-2 rounded-full border border-public-border bg-public-glass px-3 py-1 text-sm font-medium text-public-muted-foreground shadow-[var(--public-shadow-floating)] backdrop-blur-xl',
                eyebrowClassName,
              )}
            >
              {eyebrow}
            </div>
          )}

          <Title
            className={cn(
              'max-w-5xl text-balance text-5xl font-semibold leading-[1.02] text-public-foreground sm:text-6xl lg:text-7xl',
              titleClassName,
            )}
          >
            {title}
          </Title>

          {description && (
            <div
              className={cn(
                'max-w-2xl text-pretty text-lg leading-8 text-public-muted-foreground sm:text-xl',
                descriptionClassName,
              )}
            >
              {description}
            </div>
          )}

          <HeroActions
            actions={actions}
            className={cn(isCentered ? 'justify-center' : 'justify-start', actionsClassName)}
          />

          {children && <div className="w-full">{children}</div>}
        </div>
      </div>
    </Root>
  );
}

function normalizeHeroBackground(
  background: HeroProps['background'],
): HeroBackgroundOptions {
  if (!background) return { preset: 'none' };

  if (React.isValidElement(background)) {
    return { custom: background };
  }

  if (isHeroBackgroundOptions(background)) return background;

  return { custom: background };
}

function isHeroBackgroundOptions(
  value: HeroProps['background'],
): value is HeroBackgroundOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    'preset' in value ||
    'custom' in value ||
    'overlay' in value ||
    'overlayClassName' in value ||
    'interactive' in value
  );
}
