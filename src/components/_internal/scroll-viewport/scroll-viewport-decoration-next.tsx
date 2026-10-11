'use client';

/**
 * Next-generation Arc scroll presentation around the semantic owner's exact
 * native viewport. Reuses proven metrics, fades and CSS while isolating the new
 * interaction controller; original decoration and public ScrollArea stay intact.
 */
import * as React from 'react';
import { useScrollViewport } from './use-scroll-viewport';
import type { ScrollViewportOrientation } from './scroll-viewport-metrics';
import { createScrollViewportInteractions, type ScrollViewportInteractions, type ScrollViewportWheelMode } from './scroll-viewport-interactions';
import './scroll-viewport.css';
import './scroll-viewport-next.css';

export interface ScrollViewportDecorationNextProps {
  readonly viewport: HTMLElement | null;
  readonly orientation?: ScrollViewportOrientation;
  readonly fadeEdges?: boolean;
  readonly scrollbars?: 'always' | 'hover' | 'scroll' | 'hidden';
  /** Conversion is opt-in; native horizontal/Shift/Ctrl gestures and nested owners stay native. */
  readonly wheelMode?: ScrollViewportWheelMode;
}

/** Decorate a positioned sibling viewport without another scroller, tab stop or focus owner. */
export function ScrollViewportDecorationNext({ viewport, orientation = 'both', fadeEdges = true, scrollbars = 'hover',
  wheelMode = 'native' }: ScrollViewportDecorationNextProps) {
  const state = useScrollViewport(viewport, orientation, fadeEdges);
  const metrics = React.useRef(state.metrics); metrics.current = state.metrics;
  const decoration = React.useRef<HTMLDivElement>(null);
  const controller = React.useRef<ScrollViewportInteractions | null>(null);
  React.useLayoutEffect(() => {
    if (!viewport) return;
    const current = createScrollViewportInteractions({ viewport, readMetrics: () => metrics.current,
      onDragging: state.setDragging, onHovered: state.setHovered });
    controller.current = current;
    return () => { controller.current = null; current.destroy(); };
  }, [viewport, state.setDragging, state.setHovered]);
  React.useLayoutEffect(() => {
    if (scrollbars === 'hidden' || state.dragging && !state.metrics?.[state.dragging].overflow) controller.current?.cancel();
  }, [scrollbars, state.dragging, state.metrics?.x.overflow, state.metrics?.y.overflow]);
  React.useEffect(() => {
    const element = decoration.current, view = viewport?.ownerDocument.defaultView;
    if (!element || !viewport || !view) return;
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof view.Element)) return;
      const rail = event.target.closest<HTMLElement>('.zero-scroll-track');
      if (!rail || !element.contains(rail)) return;
      const axis = rail.dataset.axis;
      if (axis === 'x' || axis === 'y') controller.current?.wheel(axis, event);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [viewport, !!state.metrics, scrollbars]);
  React.useEffect(() => {
    if (!viewport || wheelMode !== 'horizontal' || orientation === 'vertical') return;
    const wheel = (event: WheelEvent) => { controller.current?.wheel('x', event, true); };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [viewport, orientation, wheelMode]);
  if (!state.metrics || scrollbars === 'hidden') return null;
  return <div ref={decoration} className="zero-scroll-decoration" aria-hidden="true" data-zero-scroll-decoration="next"
    data-visible={scrollbars === 'always' || (scrollbars === 'scroll' ? state.scrolling : state.visible) || undefined}
    style={viewport ? { left: viewport.offsetLeft + viewport.clientLeft, top: viewport.offsetTop + viewport.clientTop,
      right: 'auto', bottom: 'auto', width: viewport.clientWidth, height: viewport.clientHeight } : undefined}
    data-dragging={state.dragging ?? undefined} data-both={state.metrics.x.overflow && state.metrics.y.overflow || undefined}>
    {(['x', 'y'] as const).map(axis => {
      const metric = state.metrics![axis];
      if (!metric.overflow) return null;
      return <div key={axis} className="zero-scroll-track" data-axis={axis}
        onPointerDown={event => controller.current?.start(axis, event.currentTarget, event.nativeEvent,
          event.target instanceof event.currentTarget.ownerDocument.defaultView!.Element && !!event.target.closest('[data-zero-scroll-thumb]'))}
        onPointerEnter={event => { if (event.pointerType === 'mouse') state.setHovered(true); }}
        onPointerLeave={() => state.setHovered(false)}>
        <div className="zero-scroll-thumb" data-zero-scroll-thumb="" style={axis === 'x'
          ? { width: metric.thumb, transform: `translateX(${metric.position}px)` }
          : { height: metric.thumb, transform: `translateY(${metric.position}px)` }} />
      </div>;
    })}
  </div>;
}
