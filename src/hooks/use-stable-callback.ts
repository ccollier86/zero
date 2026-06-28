/**
 * use-stable-callback.ts
 *
 * Provides a stable callback wrapper for React components and hooks. This file
 * owns callback identity management only; it does not schedule work or own
 * platform transport behavior.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Return a stable function identity that always calls the latest callback.
 *
 * Useful for event listeners, timers, and async helpers where dependency
 * churn would otherwise re-register side effects.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const callbackRef = useRef(callback);

  useIsomorphicLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useCallback((...args: Args) => callbackRef.current(...args), []);
}
