/**
 * use-media-query.ts
 *
 * Provides an SSR-safe `matchMedia` hook for responsive UI decisions. This
 * file owns browser media-query subscription state only.
 */

import { useEffect, useState } from 'react';

export interface UseMediaQueryOptions {
  /** Value returned during SSR and before the browser query is evaluated. */
  defaultValue?: boolean;
  /** Read the initial browser value during first render. Defaults to false. */
  initializeWithValue?: boolean;
}

function queryMatches(query: string, defaultValue: boolean): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return defaultValue;
  }

  return window.matchMedia(query).matches;
}

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 *
 * The hook is SSR-safe by default; pass `initializeWithValue: true` only when
 * first-render browser accuracy is more important than hydration stability.
 */
export function useMediaQuery(
  query: string,
  options: UseMediaQueryOptions = {},
): boolean {
  const { defaultValue = false, initializeWithValue = false } = options;
  const [matches, setMatches] = useState(() =>
    initializeWithValue ? queryMatches(query, defaultValue) : defaultValue,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQueryList = window.matchMedia(query);
    const update = () => setMatches(mediaQueryList.matches);
    update();

    mediaQueryList.addEventListener('change', update);
    return () => mediaQueryList.removeEventListener('change', update);
  }, [query]);

  return matches;
}
