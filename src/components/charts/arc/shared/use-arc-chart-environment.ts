'use client';
/**
 * Owns Arc-derived charts' visibility and presentation suspension. It listens
 * only to the browser environment, never to a provider, database or transport.
 */
import { useEffect, useState, type RefObject } from 'react';

/** A chart can remember its first reveal while suspending current hidden/offscreen motion. */
export interface ArcChartEnvironment {
  readonly inView: boolean;
  readonly visible: boolean;
  readonly reduced: boolean;
}

/**
 * Suspend motion outside a visible document/container. Renderers must stop
 * their animation controls when reduced changes, and retain revealed geometry.
 * SSR starts static; it still renders exact accessible data companions.
 */
export function useArcChartEnvironment(ref: RefObject<HTMLElement | null>, options: { motion?: boolean } = {}): ArcChartEnvironment {
  const [environment, setEnvironment] = useState({ seen: false, intersecting: false, hidden: true, reduce: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let alive = true;
    const media = element.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)');
    const document = element.ownerDocument;
    const publish = (patch: Partial<typeof environment>) => {
      if (!alive) return;
      setEnvironment(previous => {
        const next = { ...previous, ...patch };
        return Object.keys(next).every(key => previous[key as keyof typeof previous] === next[key as keyof typeof next]) ? previous : next;
      });
    };
    const visibility = () => publish({ hidden: document.hidden });
    const preference = () => publish({ reduce: media?.matches ?? true });
    document.addEventListener('visibilitychange', visibility);
    media?.addEventListener('change', preference);
    visibility(); preference();
    const observer = new IntersectionObserver(entries => {
      const intersecting = !!entries[0]?.isIntersecting;
      if (!alive) return;
      setEnvironment(previous => ({ ...previous, seen: previous.seen || intersecting, intersecting }));
    }, { threshold: .05 });
    observer.observe(element);
    return () => { alive = false; observer.disconnect(); document.removeEventListener('visibilitychange', visibility); media?.removeEventListener('change', preference); };
  }, [ref]);
  const visible = environment.intersecting && !environment.hidden;
  // Before the first observation, inView=false must gate the entrance instead
  // of reduced=true prematurely completing it. After reveal, leaving suspends
  // existing motion through the same instant-settle policy as reduced motion.
  return { inView: environment.seen, visible, reduced: options.motion === false || environment.reduce || (environment.seen && !visible) };
}
