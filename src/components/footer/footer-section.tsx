'use client';

/**
 * footer-section.tsx
 *
 * Renders a tokenized public footer section. This file owns footer layout and
 * public-lane styling only; callers own brand content, links, and destinations.
 */

import * as React from 'react';

import { AnimateIcon } from '#zero/components/animate-ui/icons';
import { HeroActions } from '#zero/components/hero';
import { cn } from '#zero/lib/utils';

import type { FooterSectionBrand, FooterSectionLink, FooterSectionProps } from './footer-section.types';

/** Render a full-width public footer band with brand, nav, actions, and social links. */
export function FooterSection({
  brand,
  linksTitle,
  links = [],
  actionTitle,
  actionDescription,
  actions,
  socialTitle,
  socialLinks = [],
  copyright,
  tone = 'accent',
  className,
  innerClassName,
  brandClassName,
  linksClassName,
  actionClassName,
  bottomClassName,
  ...props
}: FooterSectionProps) {
  const accentTone = tone === 'accent';
  const hasLinks = links.length > 0;
  const hasActions = Boolean(actionTitle || actionDescription || actions?.length);
  const hasBottom = Boolean(copyright || socialLinks.length);

  return (
    <footer
      data-zero-surface="public"
      className={cn(
        'zero-public relative isolate w-full overflow-hidden text-public-foreground',
        accentTone
          ? 'bg-public-accent text-public-accent-foreground shadow-[inset_0_1px_0_rgb(255_255_255_/_0.22)]'
          : 'border-y border-public-border bg-public-surface text-public-foreground',
        className,
      )}
      {...props}
    >
      {accentTone ? (
        <>
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_16%_0%,rgb(255_255_255_/_0.22),transparent_25rem),radial-gradient(circle_at_88%_18%,rgb(255_255_255_/_0.14),transparent_28rem)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-public-accent-foreground/30" />
        </>
      ) : null}
      <div
        className={cn(
          'relative mx-auto w-full max-w-7xl px-6 py-14 sm:px-8 lg:px-10 lg:py-20',
          innerClassName,
        )}
      >
        <div
          className={cn(
            'grid gap-12 lg:items-start',
            hasLinks && hasActions
              ? 'lg:grid-cols-[minmax(0,1.15fr)_minmax(11rem,0.45fr)_minmax(18rem,0.82fr)]'
              : hasLinks || hasActions
                ? 'lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]'
                : '',
          )}
        >
          <div className={cn('min-w-0', brandClassName)}>
            <FooterBrand brand={brand} accentTone={accentTone} />
            {brand.description ? (
              <p
                className={cn(
                  'mt-8 max-w-md text-pretty text-lg leading-8',
                  accentTone ? 'text-public-accent-foreground/78' : 'text-public-muted-foreground',
                )}
              >
                {brand.description}
              </p>
            ) : null}
          </div>

          {hasLinks ? (
            <FooterLinkColumn
              title={linksTitle}
              links={links}
              accentTone={accentTone}
              className={linksClassName}
            />
          ) : null}

          {hasActions ? (
            <div
              className={cn(
                'min-w-0 rounded-lg border p-5',
                accentTone
                  ? 'border-public-accent-foreground/18 bg-public-accent-foreground/10 shadow-[0_1.5rem_4rem_rgb(0_0_0_/_0.12)]'
                  : 'border-public-border bg-public-glass shadow-[var(--public-shadow-floating)] backdrop-blur-xl',
                actionClassName,
              )}
            >
              {actionTitle ? (
                <div className="text-lg font-semibold leading-7">
                  {actionTitle}
                </div>
              ) : null}
              {actionDescription ? (
                <p
                  className={cn(
                    'mt-2 text-sm leading-6',
                    accentTone ? 'text-public-accent-foreground/72' : 'text-public-muted-foreground',
                  )}
                >
                  {actionDescription}
                </p>
              ) : null}
              <HeroActions
                actions={actions}
                className={cn(
                  'mt-6 w-full min-w-0 items-stretch sm:flex-col! sm:items-stretch [&_a]:min-w-0 [&_a]:w-full [&_button]:min-w-0 [&_button]:w-full [&_span]:min-w-0 [&_span]:truncate',
                  accentTone && '[&_a]:border-public-accent-foreground/35 [&_a]:bg-transparent [&_a]:text-public-accent-foreground [&_a:hover]:bg-public-accent-foreground/12 [&_button]:border-public-accent-foreground/35 [&_button]:bg-transparent [&_button]:text-public-accent-foreground [&_button:hover]:bg-public-accent-foreground/12',
                )}
              />
            </div>
          ) : null}
        </div>

        {hasBottom ? (
          <div
            className={cn(
              'mt-14 flex flex-col gap-6 border-t pt-8 sm:flex-row sm:items-center sm:justify-between lg:mt-16',
              accentTone ? 'border-public-accent-foreground/20' : 'border-public-border',
              bottomClassName,
            )}
          >
            {copyright ? (
              <div
                className={cn(
                  'text-sm leading-6',
                  accentTone ? 'text-public-accent-foreground/72' : 'text-public-muted-foreground',
                )}
              >
                {copyright}
              </div>
            ) : null}
            {socialLinks.length > 0 ? (
              <div className="flex flex-wrap items-center gap-4">
                {socialTitle ? (
                  <span
                    className={cn(
                      'text-sm font-semibold',
                      accentTone ? 'text-public-accent-foreground/72' : 'text-public-muted-foreground',
                    )}
                  >
                    {socialTitle}
                  </span>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  {socialLinks.map((link, index) => (
                    <FooterIconLink
                      key={`${index}-${link.href}`}
                      link={link}
                      accentTone={accentTone}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </footer>
  );
}

function FooterLinkColumn({
  title,
  links,
  accentTone,
  className,
}: {
  title?: React.ReactNode;
  links: readonly FooterSectionLink[];
  accentTone: boolean;
  className?: string;
}) {
  return (
    <nav
      aria-label="Footer"
      className={cn('min-w-0', className)}
    >
      {title ? (
        <div
          className={cn(
            'mb-5 text-xs font-semibold uppercase tracking-[0.18em]',
            accentTone ? 'text-public-accent-foreground/62' : 'text-public-muted-foreground',
          )}
        >
          {title}
        </div>
      ) : null}
      <div className="grid gap-3 sm:max-w-md sm:grid-cols-2 lg:grid-cols-1">
        {links.map((link, index) => (
          <FooterTextLink
            key={`${index}-${link.href}`}
            link={link}
            accentTone={accentTone}
          />
        ))}
      </div>
    </nav>
  );
}

function FooterBrand({
  brand,
  accentTone,
}: {
  brand: FooterSectionBrand;
  accentTone: boolean;
}) {
  const content = (
    <>
      {brand.mark ? (
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-md border shadow-sm',
            accentTone
              ? 'border-public-accent-foreground/25 bg-public-accent-foreground/12'
              : 'border-public-border bg-public-surface text-public-accent',
          )}
        >
          {brand.mark}
        </span>
      ) : null}
      <span className="text-xl font-semibold tracking-normal">
        {brand.label}
      </span>
    </>
  );

  if (!brand.href) {
    return <div className="inline-flex items-center gap-3">{content}</div>;
  }

  return (
    <AnimateIcon asChild animateOnHover completeOnStop>
      <a
        href={brand.href}
        className="inline-flex items-center gap-3 rounded-md outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-public-ring"
      >
        {content}
      </a>
    </AnimateIcon>
  );
}

function FooterTextLink({
  link,
  accentTone,
}: {
  link: FooterSectionLink;
  accentTone: boolean;
}) {
  return (
    <AnimateIcon asChild animateOnHover completeOnStop>
      <a
        href={link.href}
        target={link.external ? '_blank' : undefined}
        rel={link.external ? 'noreferrer' : undefined}
        aria-label={link.ariaLabel}
        className={cn(
          'group/link inline-flex items-center gap-2 rounded-md text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-public-ring',
          accentTone
            ? 'text-public-accent-foreground/78 hover:text-public-accent-foreground'
            : 'text-public-muted-foreground hover:text-public-foreground',
        )}
      >
        {link.icon}
        <span className="transition-transform duration-200 group-hover/link:translate-x-0.5">
          {link.label}
        </span>
      </a>
    </AnimateIcon>
  );
}

function FooterIconLink({
  link,
  accentTone,
}: {
  link: FooterSectionLink;
  accentTone: boolean;
}) {
  const label = typeof link.ariaLabel === 'string'
    ? link.ariaLabel
    : typeof link.label === 'string'
      ? link.label
      : undefined;

  return (
    <AnimateIcon asChild animateOnHover animateOnTap completeOnStop>
      <a
        href={link.href}
        target={link.external ? '_blank' : undefined}
        rel={link.external ? 'noreferrer' : undefined}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex size-10 items-center justify-center rounded-full border outline-none transition focus-visible:ring-2 focus-visible:ring-public-ring',
          accentTone
            ? 'border-public-accent-foreground/18 bg-public-accent-foreground/10 text-public-accent-foreground/78 hover:bg-public-accent-foreground/15 hover:text-public-accent-foreground'
            : 'border-public-border bg-public-surface text-public-muted-foreground hover:bg-public-accent-soft hover:text-public-foreground',
        )}
      >
        {link.icon ?? <span className="text-sm font-semibold">{link.label}</span>}
      </a>
    </AnimateIcon>
  );
}
