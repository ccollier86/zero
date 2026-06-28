/**
 * use-debounced-value.ts
 *
 * Provides a small SSR-safe debounce primitive for UI input state. This file
 * owns delayed value projection only; it does not perform network requests or
 * persistence.
 */

import { useEffect, useState } from 'react';

/**
 * Return `value` after it has remained unchanged for `delayMs`.
 *
 * Pass `delayMs` as 0 to disable debouncing while preserving the same hook
 * shape in composed hooks.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }

    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
