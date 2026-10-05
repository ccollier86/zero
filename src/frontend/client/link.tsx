'use client';

/** Owns local browser navigation and optional route-module prefetch; server policy remains authoritative. */

import { createElement, useCallback, useEffect, useRef } from 'react';
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
  const prefetchedPath = useRef<string | null>(null);
  const nativeDownload = rest.download !== undefined && rest.download !== false;
  const nativeTarget = Boolean(rest.target && rest.target !== '_self');
  const prefetchDestination = useCallback(() => {
    if (nativeDownload || nativeTarget) return;
    const pathname = localNavigationPath(href);
    if (pathname === null || pathname === prefetchedPath.current) return;
    prefetchedPath.current = pathname;
    doPrefetch(pathname);
  }, [doPrefetch, href, nativeDownload, nativeTarget]);

  useEffect(() => {
    if (prefetch === 'render') prefetchDestination();
  }, [prefetch, prefetchDestination]);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      // Call user's onClick first
      onClick?.(e);
      if (e.defaultPrevented) return;

      // Don't intercept modified clicks (new tab, etc.)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      // Don't intercept non-left clicks
      if (e.button !== 0) return;

      // Downloads and non-local schemes keep the browser's native behavior.
      if (nativeDownload || localNavigationPath(href) === null) return;

      // Don't intercept links with target
      if (nativeTarget) return;

      e.preventDefault();

      if (doReplace) {
        replace(href);
      } else {
        push(href);
      }
    },
    [href, doReplace, push, replace, onClick, nativeDownload, nativeTarget]
  );

  const handleMouseEnter = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      onMouseEnter?.(e);

      if (prefetch === 'intent' && !e.defaultPrevented) prefetchDestination();
    },
    [prefetch, prefetchDestination, onMouseEnter]
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

/** Resolve only same-origin HTTP(S) routes; prefetch keys exclude query/hash. */
function localNavigationPath(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.origin !== window.location.origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}
