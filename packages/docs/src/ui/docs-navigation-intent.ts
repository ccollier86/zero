/** Classifies native link activation; does not perform navigation or change focus. */
import type { MouseEvent } from 'react';

/** Only unmodified primary activation replaces the current document. */
export function isDocsCurrentWindowNavigation(event: MouseEvent<HTMLAnchorElement>): boolean {
  const target = event.currentTarget.target;
  return !event.defaultPrevented && event.button === 0
    && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    && (!target || target === '_self') && !event.currentTarget.hasAttribute('download');
}
