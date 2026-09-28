/** Keys supported by the packaged card-style radio groups. */
export type AuthRovingRadioKey =
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'End'
  | 'Home';

/**
 * Resolve the next focusable radio for the WAI-ARIA radio-group keyboard
 * pattern. Arrow navigation wraps; Home and End jump to the bounds.
 */
export function nextAuthRovingRadioIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (!Number.isInteger(itemCount) || itemCount <= 0) return null;
  const current = Math.min(itemCount - 1, Math.max(0, currentIndex));
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (key === 'ArrowDown' || key === 'ArrowRight') {
    return (current + 1) % itemCount;
  }
  if (key === 'ArrowUp' || key === 'ArrowLeft') {
    return (current - 1 + itemCount) % itemCount;
  }
  return null;
}
