/**
 * floating-button-group-model.ts
 *
 * Owns DOM-free action identity and roving-focus decisions for the floating
 * toolbar. Consumes structural command data only; never invokes commands,
 * measures elements, or owns a selection/persistence service.
 */

/** The identity-bearing fields shared by the public action/separator union. */
export interface FloatingButtonGroupModelItem {
  type?: 'action' | 'separator';
  id?: string;
  label?: string;
  disabled?: boolean;
}

/** Pointer and keyboard material share enabled actions, not command state. */
export interface FloatingButtonGroupActiveAction {
  hoveredId: string | null;
  focusedId: string | null;
  interaction: 'pointer' | 'keyboard';
}

const isAction = (item: FloatingButtonGroupModelItem): boolean => item.type !== 'separator';

/**
 * Reject missing action identity/names and collisions before refs or paint can
 * be shared. Optional separator IDs participate in the same identity space.
 */
export function validateFloatingButtonGroupItems(items: readonly FloatingButtonGroupModelItem[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || (item.type !== undefined && item.type !== 'action' && item.type !== 'separator')) {
      throw new TypeError('FloatingButtonGroup items must be actions or separators.');
    }
    if (isAction(item)) {
      if (typeof item.id !== 'string' || !item.id.trim()) {
        throw new TypeError('FloatingButtonGroup actions require a stable, nonempty id.');
      }
      if (typeof item.label !== 'string' || !item.label.trim()) {
        throw new TypeError(`FloatingButtonGroup action ${JSON.stringify(item.id)} requires a nonempty label.`);
      }
    }
    if (item.id !== undefined) {
      if (typeof item.id !== 'string' || !item.id.trim()) {
        throw new TypeError('FloatingButtonGroup item ids must be nonempty strings.');
      }
      if (seen.has(item.id)) {
        throw new TypeError(`FloatingButtonGroup item ids must be unique: ${JSON.stringify(item.id)}.`);
      }
      seen.add(item.id);
    }
  }
}

/** Return enabled action IDs in the caller's visual/order sequence. */
export function enabledActionIds(items: readonly FloatingButtonGroupModelItem[]): string[] {
  return items.filter(item => isAction(item) && !item.disabled && typeof item.id === 'string')
    .map(item => item.id as string);
}

/** Resolve material precedence without admitting disabled or retired IDs. */
export function resolveActiveActionId(
  items: readonly FloatingButtonGroupModelItem[],
  state: FloatingButtonGroupActiveAction,
): string | null {
  const enabled = new Set(enabledActionIds(items));
  const preferred = state.interaction === 'keyboard' ? state.focusedId : state.hoveredId;
  const fallback = state.interaction === 'keyboard' ? state.hoveredId : state.focusedId;
  if (preferred !== null && enabled.has(preferred)) return preferred;
  return fallback !== null && enabled.has(fallback) ? fallback : null;
}

/**
 * Keep a live tab stop through reorder. When it retires, prefer the next
 * enabled action at its old ordinal, then walk backwards. Empty/all-disabled
 * trays return null so their native toolbar may own the fallback tab stop.
 */
export function recoverTabStop(
  previousItems: readonly FloatingButtonGroupModelItem[],
  nextItems: readonly FloatingButtonGroupModelItem[],
  previousId: string | null,
): string | null {
  const next = nextItems.filter(isAction);
  const enabled = new Set(enabledActionIds(nextItems));
  if (previousId !== null && enabled.has(previousId)) return previousId;
  if (!enabled.size) return null;
  const previousIndex = previousItems.filter(isAction).findIndex(item => item.id === previousId);
  const start = previousIndex < 0 ? 0 : Math.min(previousIndex, next.length);
  for (let index = start; index < next.length; index++) {
    const id = next[index]?.id;
    if (id !== undefined && enabled.has(id)) return id;
  }
  for (let index = start - 1; index >= 0; index--) {
    const id = next[index]?.id;
    if (id !== undefined && enabled.has(id)) return id;
  }
  return null;
}

/**
 * Resolve wrapping native toolbar navigation. Cross-axis/unrelated keys return
 * null; horizontal RTL reverses only the horizontal arrows, never Home/End.
 */
export function resolveRovingTarget(
  ids: readonly string[],
  currentId: string | null,
  key: string,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
  direction: 'ltr' | 'rtl' = 'ltr',
): string | null {
  if (!ids.length) return null;
  if (key === 'Home') return ids[0] ?? null;
  if (key === 'End') return ids[ids.length - 1] ?? null;
  let step = 0;
  if (orientation === 'vertical') {
    if (key === 'ArrowDown') step = 1;
    if (key === 'ArrowUp') step = -1;
  } else {
    if (key === 'ArrowRight') step = direction === 'rtl' ? -1 : 1;
    if (key === 'ArrowLeft') step = direction === 'rtl' ? 1 : -1;
  }
  if (!step) return null;
  const index = currentId === null ? -1 : ids.indexOf(currentId);
  if (index < 0) return step > 0 ? ids[0] ?? null : ids[ids.length - 1] ?? null;
  return ids[(index + step + ids.length) % ids.length] ?? null;
}
