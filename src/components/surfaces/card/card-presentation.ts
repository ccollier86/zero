'use client';

/** Local/canonical Card feedback resolution; never owns quick-look geometry, selection, focus or scroll locking. */
import * as React from 'react';
import { resolveThemeMotion, type ThemeCardFeedbackRecipe } from '../../../design-system/theme-motion';
import { observePresentationTheme } from '../../../lib/observe-presentation-theme';

function value(raw: string, fallback: number, maximum: number, kind: 'time' | 'number' | 'length') {
  const match = kind === 'time' ? /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/u.exec(raw)
    : kind === 'length' ? /^(\d+(?:\.\d+)?|\.\d+)px$/u.exec(raw) : /^(\d+(?:\.\d+)?|\.\d+)$/u.exec(raw);
  if (!match) return fallback;
  const parsed = Number(match[1]) * (kind === 'time' && match[2] === 's' ? 1000 : 1);
  return Number.isFinite(parsed) && parsed <= maximum ? parsed : fallback;
}

/** Read live presentation tokens at the actual card/status scope, with canonical reduced-motion policy. */
export function resolveCardFeedback(element: Element | null, reduced: boolean): ThemeCardFeedbackRecipe {
  const base = resolveThemeMotion({ reducedMotion: reduced }).recipes.cardFeedback;
  if (reduced || !element?.ownerDocument.defaultView) return base;
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  const read = (name: string) => (style.getPropertyValue(`--zero-card-${name}`) || style.getPropertyValue(`--zero-theme-card-${name}`)).trim();
  return { ...base, hoverLiftPx: value(read('hover-lift'), base.hoverLiftPx, 32, 'length'),
    mediaZoom: value(read('media-zoom'), base.mediaZoom, 2, 'number'),
    hoverInMs: value(read('hover-in-duration'), base.hoverInMs, 60_000, 'time'),
    hoverOutMs: value(read('hover-out-duration'), base.hoverOutMs, 60_000, 'time'),
    statusEnterMs: value(read('status-enter-duration'), base.statusEnterMs, 60_000, 'time'),
    statusExitMs: value(read('status-exit-duration'), base.statusExitMs, 60_000, 'time'),
    statusStaggerMs: value(read('status-stagger'), base.statusStaggerMs, 1000, 'time'),
    statusBlurPx: value(read('status-blur'), base.statusBlurPx, 32, 'length') };
}

export function useCardFeedback(element: Element | null, reduced: boolean) {
  const [feedback, setFeedback] = React.useState(() => resolveCardFeedback(element, reduced));
  React.useLayoutEffect(() => {
    const read = () => setFeedback(previous => { const next = resolveCardFeedback(element, reduced);
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next; });
    read(); return observePresentationTheme(element, read);
  }, [element, reduced]);
  return feedback;
}

/** Add only this feedback's scalar transform; native/caller transforms remain live underneath it. */
export function useCardHoverFeedback(element: HTMLElement | null, media: HTMLElement | null, hovered: boolean,
  reduced: boolean, feedback: ThemeCardFeedbackRecipe) {
  const owned = React.useRef(new Map<HTMLElement, { animation: Animation; from: number; to: number }>());
  const currentHover = React.useRef(hovered); currentHover.current = hovered;
  React.useLayoutEffect(() => {
    if (!element) return;
    const targets: Array<[HTMLElement, 'lift' | 'zoom']> = [[element, 'lift']];
    if (media) targets.push([media, 'zoom']);
    for (const [target, kind] of targets) {
      const previous = owned.current.get(target);
      const progress = previous?.animation.effect?.getComputedTiming().progress;
      const neutral = kind === 'lift' ? 0 : 1;
      const from = previous ? previous.from + (previous.to - previous.from) * (progress ?? (previous.animation.playState === 'finished' ? 1 : 0)) : neutral;
      previous?.animation.cancel(); owned.current.delete(target);
      if (reduced || (!hovered && !previous) || typeof target.animate !== 'function') continue;
      const to = hovered ? kind === 'lift' ? -feedback.hoverLiftPx : feedback.mediaZoom : neutral;
      const transform = (value: number) => kind === 'lift' ? `translateY(${value}px)` : `scale(${value})`;
      const animation = target.animate([{ transform: transform(from) }, { transform: transform(to) }], {
        duration: hovered ? feedback.hoverInMs : feedback.hoverOutMs, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards', composite: 'add',
      });
      owned.current.set(target, { animation, from, to });
      void animation.finished.then(() => {
        if (!currentHover.current && owned.current.get(target)?.animation === animation) { animation.cancel(); owned.current.delete(target); }
      }).catch(() => {});
    }
    const currentTargets = new Set(targets.map(([target]) => target));
    for (const [target, entry] of owned.current) if (!target.isConnected || !currentTargets.has(target)) {
      entry.animation.cancel(); owned.current.delete(target);
    }
  }, [element, media, hovered, reduced, feedback]);
  React.useLayoutEffect(() => () => { for (const entry of owned.current.values()) entry.animation.cancel(); owned.current.clear(); }, []);
}
