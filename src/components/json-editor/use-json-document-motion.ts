'use client';

/** Local tree geometry/presence only. Does not own scroll, focus, portal or a document clock. */
import * as React from 'react';

function duration(style: CSSStyleDeclaration, role: string, fallback: number) {
  const value = style.getPropertyValue(role).trim(), amount = parseFloat(value);
  return Number.isFinite(amount) ? Math.max(0, value.endsWith('ms') ? amount : amount * 1000) : fallback;
}

/** Snapshot painted row positions and morph the flat tree from its current geometry on interruption. */
export function useJsonDocumentMotion(root: React.RefObject<HTMLElement | null>, tree: React.RefObject<HTMLElement | null>, revision: unknown, visible: boolean) {
  const previous = React.useRef(new Map<string, number>()), previousHeight = React.useRef<number | null>(null);
  const animations = React.useRef<Animation[]>([]);
  React.useLayoutEffect(() => {
    const element = tree.current, owner = root.current, view = element?.ownerDocument.defaultView;
    const beforeHeight = element?.getBoundingClientRect().height ?? 0;
    const interrupted = animations.current.some(animation => animation.playState === 'running');
    for (const animation of animations.current) animation.cancel(); animations.current = [];
    if (!element || !owner || !view || !visible) { previous.current.clear(); previousHeight.current = null; return; }
    const style = view.getComputedStyle(owner), reduced = view.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const easing = style.getPropertyValue('--zero-json-ease').trim() || 'cubic-bezier(.2,0,0,1)';
    const height = element.offsetHeight, expanding = previousHeight.current === null || height >= previousHeight.current;
    const ms = duration(style, expanding ? '--zero-theme-duration-standard' : '--zero-theme-duration-fast', expanding ? 220 : 170);
    const next = new Map<string, number>();
    for (const row of element.querySelectorAll<HTMLElement>('[data-json-row]')) {
      const key = row.dataset.jsonRow!, position = row.offsetTop; next.set(key, position);
      const from = previous.current.get(key);
      if (!reduced && previousHeight.current !== null && row.animate) {
        const delta = from === undefined ? 4 : from - position;
        if (delta || from === undefined) animations.current.push(row.animate([
          { transform: `translateY(${delta}px)`, opacity: from === undefined ? 0 : 1 }, { transform: 'none', opacity: 1 },
        ], { duration: ms, easing }));
      }
    }
    if (!reduced && previousHeight.current !== null && height !== previousHeight.current && element.animate) {
      animations.current.push(element.animate([{ height: `${interrupted ? beforeHeight : previousHeight.current}px`, overflow: 'clip' }, { height: `${height}px`, overflow: 'clip' }], { duration: ms, easing }));
    }
    previous.current = next; previousHeight.current = height;
  }, [revision, visible]);
  React.useLayoutEffect(() => {
    const owner = root.current, view = owner?.ownerDocument.defaultView; if (!owner || !view) return;
    const policy = view.matchMedia('(prefers-reduced-motion: reduce)');
    // duration:0 does not cancel a running CSS transition. The owned root also
    // covers Code's format pill, tabs and save feedback while the tree is hidden.
    const settle = () => { if (policy.matches) for (const animation of owner.getAnimations({ subtree: true })) animation.cancel(); };
    policy.addEventListener('change', settle); return () => policy.removeEventListener('change', settle);
  }, []);
  React.useLayoutEffect(() => () => { for (const animation of animations.current) animation.cancel(); animations.current = []; }, []);
}
