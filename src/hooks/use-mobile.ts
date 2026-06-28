/**
 * use-mobile.ts
 *
 * Provides the platform's default mobile breakpoint hook. This file owns
 * responsive breakpoint state only and delegates media-query subscription to
 * `useMediaQuery`.
 */

import { useMediaQuery } from './use-media-query';

const MOBILE_BREAKPOINT = 768;

/**
 * Return true when the viewport is below Zero's default mobile breakpoint.
 */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}
