'use client';

/** Local editor key admission only. Does not register an overlay, own dismissal or intercept another editor's inputs. */
import * as React from 'react';

/** Reserve handled Escape before a dialog's document-capture dismissal, while letting the input's React handler run. */
export function useDocumentEscapeBoundary(root: React.RefObject<HTMLElement | null>) {
  React.useLayoutEffect(() => {
    const element = root.current, view = element?.ownerDocument.defaultView;
    if (!element || !view) return;
    const reserve = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (event.key !== 'Escape' || !target || typeof target.matches !== 'function') return;
      if (!element.contains(target) || !target.matches('[data-zero-document-escape]')) return;
      // IME Escape belongs to native composition, not draft cancellation or
      // dialog dismissal. Leave its native default intact and stop dispatch.
      if (event.isComposing) event.stopPropagation(); else event.preventDefault();
    };
    // Radix receives Escape at document capture, before React's local bubble
    // handler. Noncomposing Escape still reaches that handler; never claim a
    // floating layer or suppress Escape on the rest of the dialog.
    view.addEventListener('keydown', reserve, { capture: true });
    return () => view.removeEventListener('keydown', reserve, { capture: true });
  }, [root]);
}
