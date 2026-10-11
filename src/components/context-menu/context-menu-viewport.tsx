'use client';

/**
 * Exact native ContextMenu viewport and bounded owner-state admission. It consumes
 * the shared Arc attachment, adds no focus stop, and leaves menu traversal,
 * typeahead, selection, collision placement and opaque custom layout to Radix/callers.
 */
import * as React from 'react';
import { cn } from '../../lib/utils';
import { composeOverlayRefs } from '../_internal/overlay-scope/overlay-scope';
import { ScrollViewportAttachment } from '../_internal/scroll-viewport/scroll-viewport-attachment';
import type { ContextMenuViewportProps } from './context-menu.props';
import './context-menu-scroll.css';

/** Compose directly inside the semantic menu host; ref/handlers remain native DIV contracts. */
export function ContextMenuViewport({ ref, className, orientation = 'both', fadeEdges = true,
  scrollbars = 'hover', inert, children, ...props }: ContextMenuViewportProps) {
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
  const nativeRef = React.useMemo(() => composeOverlayRefs<HTMLDivElement>(setViewport, ref), [ref]);
  const [active, setActive] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!viewport) { setActive(false); return; }
    const owner = viewport.closest<HTMLElement>('[data-slot="context-menu-content"], [data-slot="context-menu-sub-content"]')
      ?? viewport.closest<HTMLElement>('[role="menu"]');
    const read = () => setActive(!owner || owner.getAttribute('data-state') !== 'closed'
      && !owner.hidden && !owner.inert && owner.getAttribute('aria-hidden') !== 'true');
    read();
    const view = viewport.ownerDocument.defaultView;
    if (!owner || !view) return;
    const observer = new view.MutationObserver(read);
    observer.observe(owner, { attributes: true, attributeFilter: ['data-state', 'hidden', 'inert', 'aria-hidden'] });
    return () => observer.disconnect();
  }, [viewport]);
  return <>
    <div {...props} ref={nativeRef} data-slot="context-menu-viewport" data-orientation={orientation}
      className={cn('zero-context-menu-scroll-viewport', className)} inert={Boolean(inert) || !active}>
      {children}
    </div>
    <ScrollViewportAttachment viewport={viewport} enabled={active && !inert} orientation={orientation}
      fadeEdges={fadeEdges} scrollbars={scrollbars} />
  </>;
}
