'use client';

/**
 * Arc ContextMenu's managed-overlay bridge. It inherits an existing owner's
 * presentation/container and registers only a genuinely open native branch;
 * Radix retains menu state, positioning, focus and dismissal. Native rollback
 * does not consume this bridge or change the original retained engine.
 */
import * as React from 'react';
import { composeOverlayRefs, useOwnedFloatingOverlay, type OverlayScope } from '../_internal/overlay-scope/overlay-scope';

type OwnedChildProps = { style?: React.CSSProperties; inert?: boolean; 'data-zero-overlay-owner'?: string };
type ContextMenuFloatingSurface = {
  ref: React.RefCallback<HTMLDivElement>;
  owner: OverlayScope | null;
  container: OverlayScope['container'];
  contentProps: OwnedChildProps;
};

/** Reserve only managed-owner props after Radix Slot's child precedence; host/key/ref/handlers/content remain unchanged. */
export function protectContextMenuOwnedChild(child: React.ReactNode, owner: OverlayScope | null): React.ReactNode {
  if (!owner || !React.isValidElement<OwnedChildProps>(child)) return child;
  return React.cloneElement(child, {
    'data-zero-overlay-owner': owner.id,
    style: { ...child.props.style, zIndex: owner.zIndex + 2,
      ...(!owner.active ? { pointerEvents: 'none' as const } : {}) },
    ...(!owner.active ? { inert: true } : {}),
  });
}

/** Compose the original native surface ref with bounded live-branch registration and reserved owner paint. */
export function useContextMenuFloatingSurface(enabled: boolean, ref: React.Ref<HTMLDivElement> | undefined,
  style: React.CSSProperties | undefined, inert: boolean | undefined): ContextMenuFloatingSurface {
  const floating = useOwnedFloatingOverlay();
  const [surface, setSurface] = React.useState<HTMLDivElement | null>(null);
  const live = React.useRef({ enabled, active: floating.owner?.active ?? true });
  live.current = { enabled, active: floating.owner?.active ?? true };
  const capture = React.useCallback((element: HTMLDivElement | null) => {
    setSurface(element);
    const admitted = element && live.current.enabled && live.current.active
      && element.getAttribute('data-state') === 'open' && !element.hidden && !element.inert
      && element.getAttribute('aria-hidden') !== 'true';
    floating.ref(admitted ? element : null);
    return () => {
      floating.ref(null);
      setSurface(current => current === element ? null : current);
    };
  }, [floating.ref]);
  const surfaceRef = React.useMemo(() => composeOverlayRefs<HTMLDivElement>(capture, ref), [capture, ref]);
  React.useLayoutEffect(() => {
    const read = () => floating.ref(surface && enabled && (floating.owner?.active ?? true)
      && surface.getAttribute('data-state') === 'open' && !surface.hidden && !surface.inert
      && surface.getAttribute('aria-hidden') !== 'true' ? surface : null);
    read();
    const view = surface?.ownerDocument.defaultView;
    const observer = surface && view ? new view.MutationObserver(read) : null;
    observer?.observe(surface!, { attributes: true, attributeFilter: ['data-state', 'hidden', 'inert', 'aria-hidden'] });
    return () => { observer?.disconnect(); floating.ref(null); };
  }, [surface, enabled, floating.ref, floating.owner?.active]);
  if (!floating.owner) return { ref: surfaceRef, owner: null, container: undefined, contentProps: { style, inert } };
  // A parent's Radix positioning/presence measurements are never the menu's own geometry.
  const theme = Object.fromEntries(Object.entries(floating.owner.themeStyle ?? {}).filter(([name]) =>
    !name.startsWith('--radix-') && !name.startsWith('--zero-anchored-')));
  return { ref: surfaceRef, owner: floating.owner, container: floating.owner.container, contentProps: {
    'data-zero-overlay-owner': floating.owner.id,
    inert: !floating.owner.active || inert,
    style: { ...theme, ...style, zIndex: floating.owner.zIndex + 2,
      ...(!floating.owner.active ? { pointerEvents: 'none' as const } : {}) },
  } };
}
