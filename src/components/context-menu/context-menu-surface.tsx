'use client';

/** Mounted native menu surface; imperative Motion animation preserves every native React event/ref. */
import * as React from 'react';
import { Slot } from 'radix-ui';
import { animate, useReducedMotion } from 'motion/react';

type ContextMenuSurfaceProps = React.ComponentProps<'div'> & { asChild?: boolean };

/** Mount inside Radix Presence so animation starts only after its real DOM surface exists. */
export function ContextMenuSurface({ asChild, ref, ...props }: ContextMenuSurfaceProps) {
  const localRef = React.useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const surfaceRef = React.useCallback((node: HTMLDivElement | null) => {
    localRef.current = node;
    if (typeof ref === 'function') {
      const cleanup = ref(node);
      if (typeof cleanup === 'function') return () => {
        if (localRef.current === node) localRef.current = null;
        cleanup();
      };
    } else if (ref) ref.current = node;
  }, [ref]);
  React.useLayoutEffect(() => {
    const element = localRef.current;
    if (!element || reducedMotion) return;
    const opacity = Number.parseFloat(getComputedStyle(element).opacity);
    const originalOpacity = element.style.opacity;
    const originalTransform = element.style.transform;
    const restore = () => {
      element.style.opacity = originalOpacity;
      element.style.transform = originalTransform;
    };
    // Native onAnimationStart/onDrag handlers must never be consumed as Motion callbacks.
    const animation = animate(element, { opacity: [0, opacity], scale: [0.97, 1] }, { duration: 0.12, onComplete: restore });
    return () => { animation.stop(); restore(); };
  }, [reducedMotion]);
  const Surface = asChild ? Slot.Root : 'div';
  return <Surface ref={surfaceRef} {...props} />;
}
