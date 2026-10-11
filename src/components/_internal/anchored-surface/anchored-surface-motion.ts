/**
 * Shared anchored-surface presentation defaults and exit-presence timing.
 * CSS owns collision-aware visual transitions; the existing Motion presence
 * owner uses a nonvisual custom property to retain the departing DOM only.
 * Radix continues to own positioning, portals, focus and dismissal.
 */
import * as React from 'react';
import type { CSSProperties } from 'react';
import type { HTMLMotionProps, TargetAndTransition } from 'motion/react';
import './anchored-surface.css';

/** Restrained Arc Popover geometry; not a trigger-rectangle FLIP or modal policy. */
export const ANCHORED_SURFACE_MOTION = Object.freeze({
  enterDuration: 580, fadeDuration: 160, exitDuration: 140, reducedDuration: 120,
  offset: 5, enterScale: .97, exitScale: .98,
});

/** Inherit presentation, never another floating branch's positioning or presence measurements. */
export function projectAnchoredSurfaceTheme(style: CSSProperties | undefined): CSSProperties {
  return Object.fromEntries(Object.entries(style ?? {}).filter(([name]) => !name.startsWith('--radix-')
    && !name.startsWith('--zero-anchored-'))) as CSSProperties;
}

/** Admit paint only after Radix's own placement has resolved; never compute or set floating geometry here. */
export function useAnchoredSurfaceReady(enabled: boolean) {
  const [element, ref] = React.useState<HTMLDivElement | null>(null);
  const [ready, setReady] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!enabled || !element) { setReady(false); return; }
    const view = element.ownerDocument.defaultView;
    const wrapper = element.parentElement;
    if (!view || !wrapper) return;
    let frame = 0, disposed = false;
    const observer = new MutationObserver(admit);
    function admit() {
      if (disposed || frame || !element?.isConnected || !wrapper?.hasAttribute('data-radix-popper-content-wrapper')) return;
      // Radix intentionally parks unmeasured content offscreen; its transform-origin is empty until positioned.
      if (!wrapper.style.getPropertyValue('--radix-popper-transform-origin').trim()) return;
      frame = view!.requestAnimationFrame(() => {
        frame = 0;
        if (disposed || !element?.isConnected) return;
        // Flush the collision-resolved side's blocked start before admitting its CSS transition.
        view!.getComputedStyle(element).transform;
        observer.disconnect(); setReady(true);
      });
    }
    observer.observe(wrapper, { attributes: true, attributeFilter: ['style'] });
    admit();
    return () => { disposed = true; observer.disconnect(); if (frame) view.cancelAnimationFrame(frame); };
  }, [enabled, element]);
  return { ref, ready };
}

function time(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/u.exec(value.trim());
  if (!match) return fallback;
  const result = Number(match[1]) * (match[2] === 's' ? 1000 : 1);
  return Number.isFinite(result) && result <= 60_000 ? result : fallback;
}

/** Resolve a bounded local token before its canonical application counterpart. */
export function anchoredSurfaceExitDuration(style: CSSProperties | undefined, reduced: boolean): number {
  const values = style as Readonly<Record<string, unknown>> | undefined;
  return reduced
    ? time(values?.['--zero-popover-reduced-duration'], time(values?.['--zero-theme-duration-instant'], ANCHORED_SURFACE_MOTION.reducedDuration))
    : time(values?.['--zero-popover-exit-duration'], time(values?.['--zero-theme-popover-exit-duration'], ANCHORED_SURFACE_MOTION.exitDuration));
}

/** Keep existing AnimatePresence alive without owning opacity or transforms. */
export function anchoredSurfacePresence(style: CSSProperties | undefined, reduced: boolean): Pick<HTMLMotionProps<'div'>, 'initial' | 'animate' | 'exit' | 'transition'> {
  return {
    initial: false,
    animate: { '--zero-anchored-presence': 0 } as TargetAndTransition,
    exit: { '--zero-anchored-presence': 1 } as TargetAndTransition,
    transition: { duration: anchoredSurfaceExitDuration(style, reduced) / 1000, ease: 'linear' },
  };
}

/** Explicit Motion recipes opt out of shared visual transitions without being rewritten. */
export function hasAnchoredSurfaceMotionOverride(props: Pick<HTMLMotionProps<'div'>, 'initial' | 'animate' | 'exit' | 'transition' | 'variants'>): boolean {
  return props.initial !== undefined || props.animate !== undefined || props.exit !== undefined
    || props.transition !== undefined || props.variants !== undefined;
}
