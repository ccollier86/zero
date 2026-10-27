'use client';

/** Mounted native menu surface; a transient entrance effect preserves consumer styles and every native React event/ref. */
import * as React from 'react';
import { Slot } from 'radix-ui';
import { useReducedMotion } from 'motion/react';

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
    if (!element || reducedMotion || typeof element.animate !== 'function') return;
    const computed = getComputedStyle(element), opacity = Number.parseFloat(computed.opacity);
    const transform = computed.transform === 'none' ? '' : computed.transform;
    // A transient native effect never owns the consumer's inline declarations.
    // Restoring inside Motion's onComplete raced its final render batch, which
    // could reapply scale/opacity after restoration under a loaded main thread.
    // Native React animation/drag handlers and the 120ms entrance stay intact.
    const animation = element.animate([
      { opacity: 0, transform: `${transform} scale(.97)`.trim() },
      { opacity, transform: transform || 'none' },
    ], { duration: 120, easing: 'ease-out', fill: 'none' });
    void animation.finished.catch(() => {});
    return () => { animation.cancel(); };
  }, [reducedMotion]);
  const Surface = asChild ? Slot.Root : 'div';
  return <Surface ref={surfaceRef} {...props} />;
}
