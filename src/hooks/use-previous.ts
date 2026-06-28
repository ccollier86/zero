/**
 * use-previous.ts
 *
 * Stores the previous render's value for comparison-oriented UI logic. This
 * file owns local render history only.
 */

import { useEffect, useRef } from 'react';

/**
 * Return the value from the previous committed render.
 *
 * Returns `undefined` on the first render.
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}
