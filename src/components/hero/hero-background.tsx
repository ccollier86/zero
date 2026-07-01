'use client';

/**
 * hero-background.tsx
 *
 * Renders reusable public Hero background layers. This file owns only visual
 * background composition and preset selection; Hero content and actions live in
 * separate modules.
 */

import * as React from 'react';

import { BubbleBackground } from '@/components/animate-ui/components/backgrounds/bubble';
import { GradientBackground } from '@/components/animate-ui/components/backgrounds/gradient';
import { HexagonBackground } from '@/components/animate-ui/components/backgrounds/hexagon';
import { StarsBackground } from '@/components/animate-ui/components/backgrounds/stars';
import { cn } from '@/lib/utils';
import { WavyBackground } from './wavy-background';
import type {
  HeroBackgroundOptions,
  HeroBackgroundPreset,
  HeroImageBackgroundProps,
} from './hero.types';

const DEFAULT_OVERLAY =
  'bg-[radial-gradient(circle_at_50%_15%,transparent_0%,transparent_28rem,var(--color-public-background)_78%),linear-gradient(to_bottom,color-mix(in_oklch,var(--color-public-background)_18%,transparent),var(--color-public-background))]';

/**
 * Render a full-bleed Hero background from a preset or caller-provided node.
 *
 * Built-in presets use the public token lane where possible. Use `custom` when
 * a page needs a product image, generated image, video, or future text/visual
 * effect component.
 */
export function HeroBackground({
  preset = 'aurora',
  custom,
  className,
  overlay = true,
  overlayClassName,
  interactive = false,
}: HeroBackgroundOptions) {
  if (preset === 'none' && !custom) return null;

  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
      {custom ? (
        <div className={cn('absolute inset-0', className)}>{custom}</div>
      ) : (
        <HeroPresetBackground
          preset={preset}
          interactive={interactive}
          className={className}
        />
      )}
      {overlay && (
        <div className={cn('absolute inset-0', DEFAULT_OVERLAY, overlayClassName)} />
      )}
    </div>
  );
}

/**
 * Render an image as a full-bleed Hero background.
 *
 * The image is decorative unless `alt` is supplied. Keep product/person/place
 * images inspectable and avoid hiding important subject matter behind overlays.
 */
export function HeroImageBackground({
  src,
  alt = '',
  priority = false,
  className,
  imageClassName,
  overlayClassName,
  children,
}: HeroImageBackgroundProps) {
  return (
    <div className={cn('absolute inset-0 size-full overflow-hidden', className)}>
      <img
        src={src}
        alt={alt}
        fetchPriority={priority ? 'high' : undefined}
        className={cn('size-full object-cover', imageClassName)}
      />
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-b from-public-background/20 via-public-background/48 to-public-background',
          overlayClassName,
        )}
      />
      {children}
    </div>
  );
}

function HeroPresetBackground({
  preset,
  interactive,
  className,
}: {
  preset: HeroBackgroundPreset;
  interactive: boolean;
  className?: string;
}) {
  switch (preset) {
    case 'gradient':
      return (
        <GradientBackground
          className={cn(
            'absolute inset-0 size-full opacity-75 saturate-125',
            className,
          )}
        />
      );
    case 'stars':
      return (
        <StarsBackground
          pointerEvents={interactive}
          starColor="color-mix(in oklch, var(--color-public-foreground) 78%, transparent)"
          className={cn('absolute inset-0 bg-public-background', className)}
        />
      );
    case 'bubbles':
      return (
        <BubbleBackground
          interactive={interactive}
          className={cn('absolute inset-0 bg-public-background', className)}
          colors={{
            first: '74,119,255',
            second: '164,85,255',
            third: '33,212,255',
            fourth: '255,91,125',
            fifth: '255,193,77',
            sixth: '123,255,191',
          }}
        />
      );
    case 'wavy':
      return (
        <WavyBackground
          className={cn('absolute inset-0 bg-public-background', className)}
          waveOpacity={0.54}
          blur={10}
        />
      );
    case 'hexagon':
      return (
        <HexagonBackground
          className={cn(
            'absolute inset-0 bg-public-background opacity-75 dark:opacity-50',
            className,
          )}
          hexagonProps={{
            className:
              'before:bg-public-border/30 after:bg-public-background hover:before:bg-public-accent-soft hover:after:bg-public-surface',
          }}
        />
      );
    case 'aurora':
    case 'none':
      return (
        <div
          className={cn(
            'absolute inset-0 bg-public-background',
            'before:absolute before:inset-x-[-20%] before:top-[-35%] before:h-[34rem] before:rounded-full before:bg-[radial-gradient(circle_at_35%_35%,color-mix(in_oklch,var(--color-public-accent)_44%,transparent),transparent_62%)] before:blur-3xl before:content-[""]',
            'after:absolute after:right-[-12%] after:top-[16%] after:size-[26rem] after:rounded-full after:bg-[radial-gradient(circle,color-mix(in_oklch,var(--color-public-accent)_22%,transparent),transparent_68%)] after:blur-3xl after:content-[""]',
            className,
          )}
        />
      );
  }
}
