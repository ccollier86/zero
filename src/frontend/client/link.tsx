'use client';

import { createElement, useCallback, useRef } from 'react';
import type { MouseEvent, AnchorHTMLAttributes, ReactNode } from 'react';
import { useRouter } from './router-context';

// ─── Link Component ────────────────────────────────────────────────────────

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** Target URL path */
  href: string;
  /** Prefetch strategy: 'intent' (hover), 'render' (immediate), 'none' */
  prefetch?: 'intent' | 'render' | 'none';
  /** Replace history instead of push */
  replace?: boolean;
  /** Children */
  children: ReactNode;
}

/**
 * Client-side navigation link.
 *
 * - Intercepts click events for SPA navigation (pushState)
 * - Falls back to native <a> for external URLs, new tabs, modified clicks
 * - Hover prefetch support (prefetch='intent')
 *
 * @example
 * ```tsx
 * <Link href="/about">About</Link>
 * <Link href="/posts/123" prefetch="intent">View Post</Link>
 * ```
 */
export function Link({
  href,
  prefetch = 'none',
  replace: doReplace = false,
  children,
  onMouseEnter,
  onClick,
  ...rest
}: LinkProps) {
  const { push, replace, prefetch: doPrefetch } = useRouter();
  const prefetched = useRef(false);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      // Call user's onClick first
      onClick?.(e);
      if (e.defaultPrevented) return;

      // Don't intercept modified clicks (new tab, etc.)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      // Don't intercept non-left clicks
      if (e.button !== 0) return;

      // Don't intercept external links
      if (isExternal(href)) return;

      // Don't intercept links with target
      if (rest.target && rest.target !== '_self') return;

      e.preventDefault();

      if (doReplace) {
        replace(href);
      } else {
        push(href);
      }
    },
    [href, doReplace, push, replace, onClick, rest.target]
  );

  const handleMouseEnter = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      onMouseEnter?.(e);

      if (prefetch === 'intent' && !prefetched.current) {
        prefetched.current = true;
        doPrefetch(href);
      }
    },
    [href, prefetch, doPrefetch, onMouseEnter]
  );

  return createElement(
    'a',
    {
      href,
      onClick: handleClick,
      onMouseEnter: prefetch === 'intent' ? handleMouseEnter : onMouseEnter,
      ...rest,
    },
    children
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isExternal(href: string): boolean {
  if (href.startsWith('http://') || href.startsWith('https://')) {
    try {
      const url = new URL(href);
      return url.origin !== window.location.origin;
    } catch {
      return false;
    }
  }
  return href.startsWith('mailto:') || href.startsWith('tel:');
}
