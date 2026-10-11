'use client';

/**
 * modal-scroll-shell.tsx
 *
 * Adds sibling-only Arc scroll decoration to the original managed shell's exact
 * native body/panel/navigation elements. Retains shell chrome, retained panels,
 * refs, forms and modality ownership; it never wraps content in another scroller.
 * The original shell and its native compatibility recipe remain unchanged.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { ModalShell } from './modal-shell';
import { composeOverlayRefs } from '../components/overlays/overlay-scope';
import { ScrollViewportDecorationNext } from '../components/_internal/scroll-viewport/scroll-viewport-decoration-next';
import './modal-scroll-treatment.css';

type ModalScrollShellProps = React.ComponentProps<typeof ModalShell>;
type ModalScrollViewport = { element: HTMLDivElement; parent: HTMLElement; navigation: boolean;
  orientation: 'both' | 'vertical' | 'horizontal'; key: number };

/** Reuses the original shell, including its original native-scroll branch; no added DOM wrapper or focus region. */
export function ModalScrollShell(props: ModalScrollShellProps) {
  const { descriptor, innerRef } = props;
  const treatment = descriptor.scrollTreatment ?? 'arc';
  const [inner, setInner] = React.useState<HTMLDivElement | null>(null);
  const [viewports, setViewports] = React.useState<readonly ModalScrollViewport[]>([]);
  const identities = React.useRef(new WeakMap<HTMLDivElement, number>()), sequence = React.useRef(0);
  const ref = React.useMemo(() => composeOverlayRefs<HTMLDivElement>(setInner, innerRef), [innerRef]);

  React.useLayoutEffect(() => {
    if (!inner) return;
    const previous = inner.getAttribute('data-zero-scroll-treatment');
    inner.setAttribute('data-zero-scroll-treatment', treatment);
    const discover = () => {
      const next: ModalScrollViewport[] = [];
      if (treatment !== 'native') for (const element of inner.querySelectorAll<HTMLDivElement>('.zero-modal__body, .zero-modal__tabs')) {
        if (element.closest('[data-zero-modal-inner]') !== inner || !element.parentElement) continue;
        if (!identities.current.has(element)) identities.current.set(element, ++sequence.current);
        const navigation = element.classList.contains('zero-modal__tabs');
        next.push({ element, parent: element.parentElement, navigation,
          orientation: navigation ? element.classList.contains('zero-modal__nav') ? 'vertical' : 'horizontal' : 'both',
          key: identities.current.get(element)! });
      }
      setViewports(current => current.length === next.length && current.every((item, index) => item.element === next[index]?.element
        && item.parent === next[index]?.parent && item.orientation === next[index]?.orientation) ? current : next);
    };
    discover();
    const Mutation = inner.ownerDocument.defaultView?.MutationObserver;
    const observer = Mutation ? new Mutation(discover) : null;
    // Track viewport replacement and the shell's responsive navigation class;
    // geometry/content updates belong to the shared adapter. Sibling rail
    // insertion cannot create a second owner.
    observer?.observe(inner, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => {
      observer?.disconnect();
      if (inner.getAttribute('data-zero-scroll-treatment') === treatment) {
        if (previous === null) inner.removeAttribute('data-zero-scroll-treatment');
        else inner.setAttribute('data-zero-scroll-treatment', previous);
      }
    };
  }, [inner, treatment]);

  return <><ModalShell {...props} innerRef={ref} />{treatment === 'arc' && viewports.map(({ element: viewport, parent, orientation, navigation, key }) => {
    if (!viewport.isConnected || !inner?.contains(viewport)) return null;
    const policy = navigation ? descriptor.navScrollbar : descriptor.scrollbar;
    return createPortal(<ScrollViewportDecorationNext viewport={viewport} orientation={orientation}
      scrollbars={policy === 'hidden' ? 'hidden' : policy === 'thin' ? 'always' : 'hover'}
      wheelMode={orientation === 'horizontal' ? 'horizontal' : 'native'} />, parent, `modal-scroll-${key}`);
  })}</>;
}
