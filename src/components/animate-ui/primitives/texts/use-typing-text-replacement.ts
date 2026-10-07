'use client';

/**
 * Private replacement timing for TypingText. Owns grapheme-safe, interruptible
 * presentation and media-query lifecycle; it never delays accepted application data.
 */
import * as React from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const FRAME_MS = 16;
const useLayout = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

interface TypingTextReplacementOptions {
  text: string;
  duration: number;
  maxDuration: number;
  enabled: boolean;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function subscribeReducedMotion(listener: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

function graphemes(text: string) {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
  }
  // Without grapheme segmentation, use an atomic step rather than splitting a composed character.
  return text ? [text] : [];
}

/** Keep first paint final; later changes erase the currently shown value and type only the latest target. */
export function useTypingTextReplacement({ text, duration, maxDuration, enabled }: TypingTextReplacementOptions) {
  const reduced = React.useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const [presentation, setPresentation] = React.useState({ displayedText: text, isTyping: false });
  const displayed = React.useRef(text);
  const generation = React.useRef(0);

  useLayout(() => {
    const currentGeneration = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = (value: string, isTyping: boolean) => {
      displayed.current = value;
      setPresentation(current => current.displayedText === value && current.isTyping === isTyping
        ? current : { displayedText: value, isTyping });
    };
    const retire = () => { generation.current++; if (timer !== undefined) clearTimeout(timer); };

    if (!enabled || reduced || displayed.current === text) {
      publish(text, false);
      return retire;
    }

    const previous = graphemes(displayed.current);
    const next = graphemes(text);
    const cadence = Number.isFinite(duration) && duration > 0 ? duration : 24;
    const budget = Number.isFinite(maxDuration) && maxDuration > 0 ? maxDuration : 525;
    // Cap each phase before sharing the total budget so an enormous target cannot erase a short old value in <1 frame.
    const eraseRequested = Math.min(budget, previous.length * cadence);
    const typeRequested = Math.min(budget, next.length * cadence);
    const total = Math.min(budget, eraseRequested + typeRequested);
    const scale = total / (eraseRequested + typeRequested);
    const eraseDuration = eraseRequested * scale;
    const typeDuration = typeRequested * scale;
    const started = performance.now();
    publish(displayed.current, true);

    const tick = () => {
      if (generation.current !== currentGeneration) return;
      const elapsed = performance.now() - started;
      const erasing = elapsed < eraseDuration;
      const finished = elapsed >= total;
      const count = erasing
        ? Math.floor(elapsed / eraseDuration * previous.length)
        : typeDuration > 0 ? Math.floor(Math.min(1, (elapsed - eraseDuration) / typeDuration) * next.length) : next.length;
      publish(finished ? text : erasing ? previous.slice(0, previous.length - count).join('') : next.slice(0, count).join(''), !finished);
      if (!finished) {
        const interval = erasing ? eraseDuration / previous.length : typeDuration / next.length;
        const boundary = erasing ? eraseDuration : total;
        timer = setTimeout(tick, Math.min(Math.max(FRAME_MS, interval), Math.max(1, boundary - elapsed)));
      }
    };

    // One pending timer; callbacks follow phase/frame cadence rather than growing with huge strings.
    const firstInterval = previous.length > 0 ? eraseDuration / previous.length : typeDuration / next.length;
    timer = setTimeout(tick, Math.min(Math.max(FRAME_MS, firstInterval), total));
    return retire;
  }, [text, duration, maxDuration, enabled, reduced]);

  return { displayedText: presentation.displayedText,
    isTyping: enabled && !reduced && (presentation.isTyping || presentation.displayedText !== text) };
}
