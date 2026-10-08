'use client';

/** React-owned overlay identity/layers; Radix owns focus and dismissal, not this context. */
import * as React from 'react';

export interface OverlayScope {
  readonly id: string;
  readonly zIndex: number;
  readonly active: boolean;
  readonly container?: HTMLElement | null;
  readonly themeStyle?: React.CSSProperties;
}

const Context = React.createContext<OverlayScope | null>(null);
const floatingOwners = new Map<string, Set<object>>();

/** Portals retain React context even when their DOM is outside the dialog's clipping area. */
export const OverlayScopeProvider = Context.Provider;
export function useOverlayScope(): OverlayScope | null { return React.useContext(Context); }

/** Admission checks use mounted branches, never global key handlers or guessed z-index selectors. */
export function hasOwnedFloatingOverlay(id: string): boolean {
  return (floatingOwners.get(id)?.size ?? 0) > 0;
}

/** Register one mounted floating branch and inherit its owner's token lane and layer. */
export function useOwnedFloatingOverlay() {
  const owner = useOverlayScope();
  const cleanup = React.useRef<(() => void) | null>(null);
  const ref = React.useCallback((element: HTMLElement | null) => {
    cleanup.current?.(); cleanup.current = null;
    if (!element || !owner) return;
    const token = {}, entries = floatingOwners.get(owner.id) ?? new Set<object>();
    entries.add(token); floatingOwners.set(owner.id, entries);
    cleanup.current = () => { entries.delete(token); if (!entries.size) floatingOwners.delete(owner.id); };
  }, [owner?.id]);
  React.useEffect(() => () => cleanup.current?.(), []);
  return owner ? {
    owner,
    ref,
    contentProps: {
      'data-zero-overlay-owner': owner.id,
      inert: !owner.active || undefined,
      style: { ...owner.themeStyle, zIndex: owner.zIndex + 2,
        ...(!owner.active ? { pointerEvents: 'none' as const } : {}) },
    },
  } : { owner: null, ref, contentProps: {} };
}

/** Compose an owned mounted-branch ref with an existing control's measurement/focus ref. */
export function composeOverlayRefs<T extends HTMLElement>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return element => {
    const cleanups = refs.map(ref => {
      if (typeof ref === 'function') return { ref, cleanup: ref(element) };
      if (ref) ref.current = element;
      return { ref, cleanup: undefined };
    });
    return () => { for (const { ref, cleanup } of cleanups) {
      if (typeof cleanup === 'function') cleanup();
      else if (typeof ref === 'function') ref(null);
      else if (ref) ref.current = null;
    } };
  };
}

/** Theme changes propagate through owned portals, including an app's scoped public theme. */
export function useOverlayTheme(source: Element | null): React.CSSProperties {
  const read = React.useCallback(() => readOverlayTheme(source?.isConnected ? source
    : typeof document === 'undefined' ? null : document.documentElement), [source]);
  const [theme, setTheme] = React.useState(read);
  React.useLayoutEffect(() => {
    const refresh = () => setTheme(previous => {
      const next = read();
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
    });
    refresh();
    const observer = new MutationObserver(refresh);
    let element: Element | null = source?.isConnected ? source : document.documentElement;
    while (element) { observer.observe(element, { attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-zero-surface', 'data-zero-page'] }); element = element.parentElement; }
    return () => observer.disconnect();
  }, [read, source]);
  return theme;
}

/** Copy inherited theme tokens only; no app records, arbitrary markup or computed layout is projected. */
export function readOverlayTheme(element: Element | null): React.CSSProperties {
  if (!element || typeof getComputedStyle !== 'function') return {};
  const style = getComputedStyle(element), values: Record<string, string> = {};
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (name.startsWith('--')) values[name] = style.getPropertyValue(name);
  }
  values.colorScheme = style.colorScheme;
  return values as React.CSSProperties;
}
