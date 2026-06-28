'use client';

/**
 * use-motion-value-state.tsx
 *
 * Bridges MotionValue changes into React render state. This file owns Motion
 * value subscription only.
 */

import * as React from 'react';
import { type MotionValue } from 'motion/react';

/**
 * Subscribe to a MotionValue and return its current numeric value.
 */
function useMotionValueState(motionValue: MotionValue): number {
  return React.useSyncExternalStore(
    (callback) => {
      const unsub = motionValue.on('change', callback);
      return unsub;
    },
    () => motionValue.get(),
    () => motionValue.get(),
  );
}

export { useMotionValueState };
