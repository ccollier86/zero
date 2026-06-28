/**
 * use-text-selection.ts
 *
 * Provides page text-selection tracking for reusable UI behavior. This file
 * owns selection event subscription only; it does not render toolbars or mutate
 * selected content.
 */

import { useEffect, useReducer, useRef } from 'react';

function getSelectionSignature(selection: Selection | null): string {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';

  return [
    selection.toString(),
    selection.rangeCount,
    selection.anchorOffset,
    selection.focusOffset,
  ].join(':');
}

/**
 * Return the current non-collapsed page text selection.
 *
 * The hook mirrors the simple `Selection | null` shape used by polished hook
 * libraries while forcing React updates when the browser mutates the same
 * Selection object in place.
 */
export function useTextSelection(): Selection | null {
  const selectionRef = useRef<Selection | null>(null);
  const signatureRef = useRef('');
  const [, forceUpdate] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    const rootDocument = typeof document === 'undefined' ? null : document;
    const rootWindow = typeof window === 'undefined' ? null : window;
    if (!rootDocument) return;

    const updateSelection = () => {
      const selection = rootDocument.getSelection();
      const signature = getSelectionSignature(selection);
      const nextSelection = signature ? selection : null;

      selectionRef.current = nextSelection;
      if (signatureRef.current === signature) return;

      signatureRef.current = signature;
      forceUpdate();
    };

    rootDocument.addEventListener('selectionchange', updateSelection);
    rootWindow?.addEventListener('mouseup', updateSelection);
    rootWindow?.addEventListener('keyup', updateSelection);
    updateSelection();

    return () => {
      rootDocument.removeEventListener('selectionchange', updateSelection);
      rootWindow?.removeEventListener('mouseup', updateSelection);
      rootWindow?.removeEventListener('keyup', updateSelection);
    };
  }, []);

  return selectionRef.current;
}
