/** Tooltip activation policy only; no timers, rendering, persistence or transport. */

/** Detect horizontal or multiline clipping without inventing truncation styles. */
export function hasTooltipOverflow(element: HTMLElement | null): boolean {
  return !!element && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
}

/** Keyboard hints open on visible focus; clicking or touch focus must not pin them. */
export function hasTooltipKeyboardFocus(element: HTMLElement): boolean {
  return element.matches(':focus-visible');
}

/** Preserve an existing description while adding exactly one owned tooltip id. */
export function mergeTooltipDescription(existing: string | null | undefined, tooltipId?: string): string | undefined {
  const ids = new Set(existing?.split(/\s+/u).filter(Boolean));
  if (tooltipId) ids.add(tooltipId);
  return ids.size ? [...ids].join(' ') : undefined;
}
