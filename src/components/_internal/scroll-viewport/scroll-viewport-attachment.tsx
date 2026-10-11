'use client';

/**
 * Attaches the next shared decoration beside one already-owned native viewport.
 * It leases only a static parent's containing block; it creates no scrolling or
 * focus region and does not own the enclosing picker/menu's presence or data.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { ScrollViewportDecorationNext } from './scroll-viewport-decoration-next';
import type { ScrollViewportOrientation } from './scroll-viewport-metrics';
import type { ScrollViewportWheelMode } from './scroll-viewport-interactions';

interface ParentLease { count: number; value: string; priority: string }
const parentLeases = new WeakMap<HTMLElement, ParentLease>();

/** Share a static parent's containing block and restore its exact authored inline value on final release. */
export function leaseScrollViewportParent(parent: HTMLElement): () => void {
  let lease = parentLeases.get(parent);
  if (!lease) {
    const view = parent.ownerDocument.defaultView;
    if (!view || view.getComputedStyle(parent).position !== 'static') return () => undefined;
    lease = { count: 0, value: parent.style.getPropertyValue('position'), priority: parent.style.getPropertyPriority('position') };
    parentLeases.set(parent, lease);
    parent.style.setProperty('position', 'relative', 'important');
  }
  lease.count++;
  const owned = lease;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owned.count > 0) return;
    parentLeases.delete(parent);
    // An external owner may deliberately replace its position while mounted.
    if (parent.style.getPropertyValue('position') !== 'relative' || parent.style.getPropertyPriority('position') !== 'important') return;
    if (owned.value) parent.style.setProperty('position', owned.value, owned.priority);
    else parent.style.removeProperty('position');
  };
}

export interface ScrollViewportAttachmentProps {
  readonly viewport: HTMLElement | null;
  readonly enabled?: boolean;
  readonly orientation?: ScrollViewportOrientation;
  readonly fadeEdges?: boolean;
  readonly scrollbars?: 'always' | 'hover' | 'scroll' | 'hidden';
  readonly wheelMode?: ScrollViewportWheelMode;
}

/** Admit decoration only after the exact sibling containing block is ready; server output remains empty. */
export function ScrollViewportAttachment({ viewport, enabled = true, ...props }: ScrollViewportAttachmentProps) {
  const [parent, setParent] = React.useState<HTMLElement | null>(null);
  const [positioned, setPositioned] = React.useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    const discover = () => setParent(current => {
      const next = enabled && viewport?.isConnected ? viewport.parentElement : null;
      return current === next ? current : next;
    });
    discover();
    const owner = viewport?.parentElement;
    const Mutation = viewport?.ownerDocument.defaultView?.MutationObserver;
    const observer = owner && Mutation ? new Mutation(discover) : null;
    observer?.observe(owner!, { childList: true });
    return () => observer?.disconnect();
  }, [viewport, enabled, parent]);
  React.useLayoutEffect(() => {
    if (!parent || !enabled) { setPositioned(null); return; }
    const release = leaseScrollViewportParent(parent);
    setPositioned(parent);
    return release;
  }, [parent, enabled]);
  return enabled && viewport?.isConnected && parent && positioned === parent && viewport.parentElement === parent
    ? createPortal(<ScrollViewportDecorationNext {...props} viewport={viewport} />, parent)
    : null;
}
