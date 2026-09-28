'use client';

/**
 * hero-actions.tsx
 *
 * Renders Hero call-to-action controls. This file owns action layout and
 * public-lane button styling only; Hero owns content structure and callers own
 * navigation behavior.
 */

import * as React from 'react';

import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';
import type { HeroAction } from './hero.types';

/** Render public-lane Hero call-to-action buttons. */
export function HeroActions({
  actions,
  className,
}: {
  actions?: readonly HeroAction[];
  className?: string;
}) {
  if (!actions?.length) return null;

  return (
    <div className={cn('flex flex-col items-center gap-3 sm:flex-row', className)}>
      {actions.map((action) => (
        <HeroActionButton
          key={`${action.label}-${action.href ?? 'button'}`}
          action={action}
        />
      ))}
    </div>
  );
}

function HeroActionButton({ action }: { action: HeroAction }) {
  const variant = action.variant ?? 'default';
  const className = cn(getHeroActionClassName(variant), action.className);
  const content = (
    <>
      {action.icon}
      <span>{action.label}</span>
    </>
  );

  if (action.href) {
    return (
      <Button asChild size="lg" variant={variant} className={className}>
        <a
          href={action.href}
          target={action.external ? '_blank' : undefined}
          rel={action.external ? 'noreferrer' : undefined}
          onClick={action.onClick}
        >
          {content}
        </a>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="lg"
      variant={variant}
      className={className}
      onClick={action.onClick}
    >
      {content}
    </Button>
  );
}

function getHeroActionClassName(variant: HeroAction['variant']): string {
  switch (variant) {
    case 'destructive':
      return '';
    case 'ghost':
      return 'text-public-muted-foreground hover:bg-public-accent-soft hover:text-public-foreground focus-visible:ring-public-ring';
    case 'link':
      return 'px-1 text-public-accent hover:text-public-accent hover:underline focus-visible:ring-public-ring';
    case 'outline':
      return 'border-public-border bg-public-glass text-public-foreground shadow-[var(--public-shadow-floating)] backdrop-blur-xl hover:bg-public-accent-soft hover:text-public-foreground focus-visible:ring-public-ring';
    case 'secondary':
      return 'bg-public-muted text-public-foreground hover:bg-public-accent-soft hover:text-public-foreground focus-visible:ring-public-ring';
    case 'default':
    case null:
    case undefined:
      return 'bg-public-accent text-public-accent-foreground shadow-[var(--public-shadow-floating)] hover:bg-public-accent/90 focus-visible:ring-public-ring';
  }

  return '';
}
