'use client';

import * as React from 'react';
import { type GroupImperativeHandle, type Layout, type LayoutChangedMeta } from 'react-resizable-panels';
import { useIsMobile } from '#zero/hooks/use-mobile';

/** Adapts legacy CSS tracks and responsive visibility; never implements resizing. */
export function useListDetailPanels(listWidth: string, detailWidth: string, detailVisible: boolean, mobileDetailOpen: boolean) {
  const mobile = useIsMobile();
  const id = React.useId();
  const listId = `${id}-list`, detailId = `${id}-detail`;
  const elementRef = React.useRef<HTMLDivElement>(null);
  const groupRef = React.useRef<GroupImperativeHandle>(null);
  const desktopLayout = React.useRef<Layout | null>(null);
  const listVisible = !mobile || !mobileDetailOpen;
  const detailShown = mobile ? mobileDetailOpen : detailVisible;

  React.useLayoutEffect(() => { desktopLayout.current = null; }, [listWidth, detailWidth]);
  React.useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const apply = () => {
      const group = groupRef.current;
      if (!group) return;
      if (mobile || !detailVisible) {
        group.setLayout({ [listId]: listVisible ? 100 : 0, [detailId]: detailShown ? 100 : 0 });
      } else {
        const initial = measureTracks(element, listWidth, detailWidth);
        if (desktopLayout.current) group.setLayout(desktopLayout.current);
        else if (initial) group.setLayout({ [listId]: initial.list!, [detailId]: initial.detail! });
      }
    };
    apply();
    // Panel registration and media-query hydration can complete after this effect.
    const frame = requestAnimationFrame(apply);
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [mobile, listVisible, detailShown, detailVisible, listWidth, detailWidth, listId, detailId]);

  const onLayoutChanged = React.useCallback((layout: Layout, meta: LayoutChangedMeta) => {
    if (!mobile && detailVisible && meta.isUserInteraction) desktopLayout.current = meta.requestedLayout ?? layout;
  }, [mobile, detailVisible]);

  return { mobile, elementRef, groupRef, onLayoutChanged, listVisible, detailShown, listId, detailId };
}

/** Let CSS resolve fr/minmax/length/calc tracks rather than inventing a CSS parser. */
function measureTracks(element: HTMLElement, listWidth: string, detailWidth: string): Layout | null {
  const separator = element.querySelector<HTMLElement>(':scope > [data-separator]');
  const width = element.clientWidth - (separator?.getBoundingClientRect().width ?? 0);
  if (width <= 0) return null;
  const probe = document.createElement('div');
  const list = document.createElement('div'), detail = document.createElement('div');
  const shrinkTrack = (track: string) => /^\d+(?:\.\d+)?fr$/.test(track.trim()) ? `minmax(0, ${track})` : track;
  Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
    display: 'grid', height: '0', width: `${width}px`, gridTemplateColumns: `${shrinkTrack(listWidth)} ${shrinkTrack(detailWidth)}` });
  probe.setAttribute('aria-hidden', 'true');
  probe.append(list, detail);
  element.append(probe);
  try {
    const total = list.getBoundingClientRect().width + detail.getBoundingClientRect().width;
    return total > 0 ? { list: list.getBoundingClientRect().width / total * 100, detail: detail.getBoundingClientRect().width / total * 100 } : null;
  } finally { probe.remove(); }
}
