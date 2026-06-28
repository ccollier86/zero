/**
 * use-timeout.ts
 *
 * Provides a React-safe timeout wrapper with stable callback handling. This
 * file owns timer subscription lifecycle only.
 */

import { useEffect } from 'react';
import { useStableCallback } from './use-stable-callback';

/**
 * Run a callback once after `delayMs`.
 *
 * Pass `null` to pause/disable the timeout without changing hook order.
 */
export function useTimeout(callback: () => void, delayMs: number | null): void {
  const stableCallback = useStableCallback(callback);

  useEffect(() => {
    if (delayMs === null) return;

    const timeout = window.setTimeout(stableCallback, delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, stableCallback]);
}
