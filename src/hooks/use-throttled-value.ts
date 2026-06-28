/**
 * use-throttled-value.ts
 *
 * Provides a throttled value projection for React UI state. This file owns
 * delayed value updates only; it does not perform network requests or
 * persistence.
 */

import { useEffect, useState } from 'react';
import { useThrottledCallback, type UseThrottledCallbackOptions } from './use-throttled-callback';

export type UseThrottledValueOptions = UseThrottledCallbackOptions;

/**
 * Return `value` updated at most once per `waitMs`.
 *
 * Use this for fast-changing input, scroll, resize, or sensor state when UI
 * renders should be rate-limited.
 */
export function useThrottledValue<T>(
  value: T,
  waitMs = 500,
  options: UseThrottledValueOptions = {},
): T {
  const [throttled, setThrottled] = useState(value);
  const updateThrottled = useThrottledCallback(setThrottled, waitMs, options);

  useEffect(() => {
    updateThrottled(value);
  }, [updateThrottled, value]);

  return throttled;
}
