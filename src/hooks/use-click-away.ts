/**
 * use-click-away.ts
 *
 * Provides a document-level outside-interaction hook for reusable UI
 * primitives. This file owns browser event subscription only; it does not own
 * modal state, routing, or persistence behavior.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { useStableCallback } from './use-stable-callback';

export type ClickAwayEvent = MouseEvent | TouchEvent | PointerEvent | FocusEvent;

export interface UseClickAwayOptions {
  /** Event names registered on the document. Defaults to mouse and touch starts. */
  events?: readonly string[];
  /** Disable listeners without changing hook order. */
  enabled?: boolean;
  /** Override the document for iframe or test environments. */
  document?: Document | null;
}

const DEFAULT_CLICK_AWAY_EVENTS = ['mousedown', 'touchstart'] as const;

function isDomNode(value: unknown): value is Node {
  return Boolean(value) && typeof (value as { nodeType?: unknown }).nodeType === 'number';
}

/**
 * Return a ref and call `handler` when configured document events occur
 * outside of the referenced element.
 *
 * Attach the returned ref to the element that should be treated as inside the
 * boundary. The hook is SSR-safe and does not register listeners until mounted.
 */
export function useClickAway<TElement extends HTMLElement>(
  handler: (event: ClickAwayEvent) => void,
  options: UseClickAwayOptions = {},
): RefObject<TElement | null> {
  const ref = useRef<TElement | null>(null);
  const stableHandler = useStableCallback(handler);
  const enabled = options.enabled ?? true;
  const events = options.events ?? DEFAULT_CLICK_AWAY_EVENTS;
  const rootDocument = options.document;

  useEffect(() => {
    if (!enabled) return;

    const doc = rootDocument ?? (typeof document === 'undefined' ? null : document);
    if (!doc) return;

    const listener = (event: Event) => {
      const element = ref.current;
      const target = event.target;

      if (!element || !isDomNode(target) || element.contains(target)) return;
      stableHandler(event as ClickAwayEvent);
    };

    events.forEach((eventName) => doc.addEventListener(eventName, listener, true));
    return () => {
      events.forEach((eventName) => doc.removeEventListener(eventName, listener, true));
    };
  }, [enabled, events, rootDocument, stableHandler]);

  return ref;
}
