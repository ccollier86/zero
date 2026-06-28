/**
 * use-interval.ts
 *
 * Provides a React-safe interval wrapper with stable callback handling. This
 * file owns timer subscription lifecycle only.
 */

import { useEffect } from 'react';
import { useStableCallback } from './use-stable-callback';

export interface UseIntervalOptions {
  /** Run the callback once immediately when the interval is enabled. */
  immediate?: boolean;
}

/**
 * Run a callback on an interval while `delayMs` is a number.
 *
 * Pass `null` to pause/disable the interval without changing hook order.
 */
export function useInterval(
  callback: () => void,
  delayMs: number | null,
  options: UseIntervalOptions = {},
): void {
  const stableCallback = useStableCallback(callback);
  const immediate = options.immediate ?? false;

  useEffect(() => {
    if (delayMs === null) return;
    if (immediate) stableCallback();

    const interval = window.setInterval(stableCallback, delayMs);
    return () => window.clearInterval(interval);
  }, [delayMs, immediate, stableCallback]);
}
