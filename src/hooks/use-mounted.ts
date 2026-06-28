/**
 * use-mounted.ts
 *
 * Tracks whether a component has mounted in the browser. This file owns
 * hydration-safe mounted state only.
 */

import { useEffect, useState } from 'react';

/**
 * Return false during SSR/first render, then true after browser mount.
 *
 * Useful for UI that must avoid browser-only APIs or hydration-sensitive
 * rendering until after React has mounted.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}
