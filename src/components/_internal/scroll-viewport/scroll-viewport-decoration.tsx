'use client';

/** Shared Arc-style edge fades and native scroll rails beside an existing viewport; no nested scroller or new tab stop. */
import * as React from 'react';
import { useScrollViewport } from './use-scroll-viewport';
import type { ScrollViewportOrientation } from './scroll-viewport-metrics';
import './scroll-viewport.css';

export interface ScrollViewportDecorationProps {
  readonly viewport: HTMLElement | null;
  readonly orientation?: ScrollViewportOrientation;
  readonly fadeEdges?: boolean;
  readonly scrollbars?: 'hover' | 'scroll' | 'always' | 'hidden';
}

/** Decorates the exact Radix/cmdk/native viewport supplied by its semantic owner. Parent must establish a positioned box. */
export function ScrollViewportDecoration({ viewport, orientation = 'vertical', fadeEdges = true, scrollbars = 'hover' }: ScrollViewportDecorationProps) {
  const state = useScrollViewport(viewport, orientation, fadeEdges);
  const decoration = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ axis: 'x' | 'y'; pointer: number; coordinate: number; offset: number; maximum: number; travel: number; scale: number; capture: HTMLDivElement } | null>(null);
  React.useEffect(() => () => {
    const active = drag.current; drag.current = null;
    if (active?.capture.hasPointerCapture(active.pointer)) active.capture.releasePointerCapture(active.pointer);
  }, [viewport]);
  React.useLayoutEffect(() => {
    const active = drag.current;
    if (!active || scrollbars !== 'hidden' && state.metrics?.[active.axis].overflow) return;
    drag.current = null; state.setDragging(null); state.setHovered(false);
    if (active.capture.hasPointerCapture(active.pointer)) active.capture.releasePointerCapture(active.pointer);
  }, [scrollbars, state.metrics?.x.overflow, state.metrics?.y.overflow]);
  const scrollTo = (axis: 'x' | 'y', offset: number) => {
    if (!viewport || !state.metrics) return;
    const metric = state.metrics[axis], bounded = Math.max(0, Math.min(metric.maximum, offset));
    if (axis === 'y') viewport.scrollTop = bounded;
    else viewport.scrollLeft = viewport.ownerDocument.defaultView?.getComputedStyle(viewport).direction === 'rtl' ? bounded - metric.maximum : bounded;
  };
  const start = (axis: 'x' | 'y', event: React.PointerEvent<HTMLDivElement>) => {
    if (!viewport || !state.metrics || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const metric = state.metrics[axis], bounds = event.currentTarget.getBoundingClientRect();
    const coordinate = axis === 'x' ? event.clientX : event.clientY;
    const paintedTrack = axis === 'x' ? bounds.width : bounds.height;
    const scale = paintedTrack > 0 && metric.track > 0 ? paintedTrack / metric.track : 1;
    const within = (coordinate - (axis === 'x' ? bounds.left : bounds.top)) / scale;
    if (!(event.target as HTMLElement).closest('[data-zero-scroll-thumb]')) {
      scrollTo(axis, metric.offset + (within < metric.position ? -1 : 1) * (axis === 'x' ? viewport.clientWidth : viewport.clientHeight) * .9);
      return;
    }
    drag.current = { axis, pointer: event.pointerId, coordinate, offset: metric.offset, maximum: metric.maximum, travel: metric.track - metric.thumb, scale, capture: event.currentTarget };
    state.setDragging(axis); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId || active.travel <= 0) return;
    scrollTo(active.axis, active.offset + ((active.axis === 'x' ? event.clientX : event.clientY) - active.coordinate) / active.scale / active.travel * active.maximum);
  };
  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    const active = drag.current; drag.current = null; state.setDragging(null);
    if (active.capture.hasPointerCapture(active.pointer)) active.capture.releasePointerCapture(active.pointer);
    state.setHovered(event.currentTarget.matches(':hover'));
  };
  React.useEffect(() => {
    const element = decoration.current;
    if (!element || !viewport) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.target || !(event.target as Element).closest('.zero-scroll-track')) return;
      const axis = (event.target as Element).closest<HTMLElement>('.zero-scroll-track')?.dataset.axis;
      const mode = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (axis === 'x' ? viewport.clientWidth : viewport.clientHeight) : 1;
      if (axis === 'x') viewport.scrollLeft += (event.deltaX || event.deltaY) * mode;
      else viewport.scrollTop += event.deltaY * mode;
      event.preventDefault(); event.stopPropagation();
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [viewport, !!state.metrics, scrollbars]);
  if (!state.metrics || scrollbars === 'hidden') return null;
  return <div ref={decoration} className="zero-scroll-decoration" aria-hidden="true" data-visible={scrollbars === 'always' || (scrollbars === 'scroll' ? state.scrolling : state.visible) || undefined}
    style={viewport ? { left: viewport.offsetLeft + viewport.clientLeft, top: viewport.offsetTop + viewport.clientTop,
      right: 'auto', bottom: 'auto', width: viewport.clientWidth, height: viewport.clientHeight } : undefined}
    data-dragging={state.dragging ?? undefined} data-both={state.metrics.x.overflow && state.metrics.y.overflow || undefined}>
    {(['x', 'y'] as const).map(axis => {
      const metric = state.metrics![axis];
      if (!metric.overflow) return null;
      return <div key={axis} className="zero-scroll-track" data-axis={axis} onPointerDown={event => start(axis, event)} onPointerMove={move}
        onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onPointerEnter={event => { if (event.pointerType === 'mouse') state.setHovered(true); }}
        onPointerLeave={() => { state.setHovered(false); }}>
        <div className="zero-scroll-thumb" data-zero-scroll-thumb="" style={axis === 'x'
          ? { width: metric.thumb, transform: `translateX(${metric.position}px)` }
          : { height: metric.thumb, transform: `translateY(${metric.position}px)` }} />
      </div>;
    })}
  </div>;
}
