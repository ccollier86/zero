/**
 * use-debounced-callback.ts
 *
 * Provides a controlled debounced callback primitive for React UI code. This
 * file owns delayed callback scheduling only; it does not perform data fetching
 * or persistence.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStableCallback } from './use-stable-callback';

export interface UseDebouncedCallbackOptions {
  /** Delay in milliseconds before a trailing callback is invoked. */
  delay: number;
  /** Run a pending trailing callback during component unmount. */
  flushOnUnmount?: boolean;
  /** Invoke on the first call, then ignore calls while the delay window is open. */
  leading?: boolean;
  /** Maximum time a trailing callback may be delayed by repeated calls. */
  maxWait?: number;
}

export type UseDebouncedCallbackReturn<TCallback extends (...args: any[]) => unknown> = ((
  ...args: Parameters<TCallback>
) => void) & {
  /** Run the pending callback immediately, if one exists. */
  flush: () => void;
  /** Discard the pending callback. */
  cancel: () => void;
  /** Return true when a call is waiting to run. */
  isPending: () => boolean;
};

function resolveDebounceOptions(
  delayOrOptions: number | UseDebouncedCallbackOptions,
): UseDebouncedCallbackOptions {
  return typeof delayOrOptions === 'number'
    ? { delay: delayOrOptions }
    : delayOrOptions;
}

/**
 * Return a debounced callback with `flush`, `cancel`, and `isPending` controls.
 *
 * Use this for search inputs, autosave, and expensive event handlers where the
 * callback lifecycle matters more than just projecting a delayed value.
 */
export function useDebouncedCallback<TCallback extends (...args: any[]) => unknown>(
  callback: TCallback,
  delayOrOptions: number | UseDebouncedCallbackOptions,
): UseDebouncedCallbackReturn<TCallback> {
  const options = resolveDebounceOptions(delayOrOptions);
  const delay = Math.max(0, options.delay);
  const flushOnUnmount = options.flushOnUnmount ?? false;
  const leading = options.leading ?? false;
  const maxWait = options.maxWait;

  const stableCallback = useStableCallback(callback);
  const timeoutRef = useRef<number | null>(null);
  const maxTimeoutRef = useRef<number | null>(null);
  const argsRef = useRef<Parameters<TCallback> | null>(null);

  const clearTimers = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (maxTimeoutRef.current !== null) {
      window.clearTimeout(maxTimeoutRef.current);
      maxTimeoutRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimers();
    argsRef.current = null;
  }, [clearTimers]);

  const flush = useCallback(() => {
    const args = argsRef.current;
    if (!args) {
      cancel();
      return;
    }

    clearTimers();
    argsRef.current = null;
    stableCallback(...args);
  }, [cancel, clearTimers, stableCallback]);

  const isPending = useCallback(() => argsRef.current !== null || timeoutRef.current !== null, []);

  const debounced = useMemo(() => {
    const fn = ((...args: Parameters<TCallback>) => {
      if (typeof window === 'undefined' || delay <= 0) {
        stableCallback(...args);
        return;
      }

      if (leading) {
        if (timeoutRef.current === null) {
          stableCallback(...args);
          timeoutRef.current = window.setTimeout(() => {
            timeoutRef.current = null;
          }, delay);
        }

        return;
      }

      argsRef.current = args;

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(flush, delay);

      if (maxWait && maxWait > 0 && maxTimeoutRef.current === null) {
        maxTimeoutRef.current = window.setTimeout(flush, maxWait);
      }
    }) as UseDebouncedCallbackReturn<TCallback>;

    fn.flush = flush;
    fn.cancel = cancel;
    fn.isPending = isPending;
    return fn;
  }, [cancel, delay, flush, isPending, leading, maxWait, stableCallback]);

  useEffect(() => {
    return () => {
      if (flushOnUnmount) flush();
      else cancel();
    };
  }, [cancel, flush, flushOnUnmount]);

  return debounced;
}
