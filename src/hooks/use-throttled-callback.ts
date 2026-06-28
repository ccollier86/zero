/**
 * use-throttled-callback.ts
 *
 * Provides a controlled throttled callback primitive for React UI code. This
 * file owns callback rate limiting only; it does not perform transport,
 * storage, or rendering behavior.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStableCallback } from './use-stable-callback';

export interface UseThrottledCallbackOptions {
  /** Invoke immediately when the throttle window is closed. Defaults to true. */
  leading?: boolean;
  /** Invoke once more with the latest args when calls happen during the window. */
  trailing?: boolean;
}

export type UseThrottledCallbackReturn<TCallback extends (...args: any[]) => unknown> = ((
  ...args: Parameters<TCallback>
) => void) & {
  /** Discard any trailing call. */
  cancel: () => void;
  /** Execute the pending trailing call immediately. */
  flush: () => void;
  /** Return true when a trailing call is waiting to run. */
  isPending: () => boolean;
};

/**
 * Return a throttled callback that runs at most once per `waitMs`.
 *
 * Use this for scroll, resize, pointer, and fast input handlers where dropping
 * intermediate calls is acceptable.
 */
export function useThrottledCallback<TCallback extends (...args: any[]) => unknown>(
  callback: TCallback,
  waitMs: number,
  options: UseThrottledCallbackOptions = {},
): UseThrottledCallbackReturn<TCallback> {
  const leading = options.leading ?? true;
  const trailing = options.trailing ?? true;
  const wait = Math.max(0, waitMs);
  const stableCallback = useStableCallback(callback);
  const timeoutRef = useRef<number | null>(null);
  const lastInvokeRef = useRef(0);
  const argsRef = useRef<Parameters<TCallback> | null>(null);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    argsRef.current = null;
  }, []);

  const invoke = useCallback(
    (timestamp: number) => {
      const args = argsRef.current;
      if (!args) return;

      lastInvokeRef.current = timestamp;
      argsRef.current = null;
      stableCallback(...args);
    },
    [stableCallback],
  );

  const flush = useCallback(() => {
    if (timeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    invoke(Date.now());
  }, [invoke]);

  const isPending = useCallback(() => timeoutRef.current !== null, []);

  const throttled = useMemo(() => {
    const fn = ((...args: Parameters<TCallback>) => {
      if (typeof window === 'undefined' || wait <= 0) {
        stableCallback(...args);
        return;
      }

      const now = Date.now();

      if (lastInvokeRef.current === 0 && !leading) {
        lastInvokeRef.current = now;
      }

      const remaining = wait - (now - lastInvokeRef.current);
      argsRef.current = args;

      if (remaining <= 0 || remaining > wait) {
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        invoke(now);
        return;
      }

      if (!trailing) {
        argsRef.current = null;
        return;
      }

      if (trailing && timeoutRef.current === null) {
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          invoke(Date.now());
        }, remaining);
      }
    }) as UseThrottledCallbackReturn<TCallback>;

    fn.cancel = cancel;
    fn.flush = flush;
    fn.isPending = isPending;
    return fn;
  }, [cancel, flush, invoke, isPending, leading, stableCallback, trailing, wait]);

  useEffect(() => cancel, [cancel]);

  return throttled;
}
