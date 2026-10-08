'use client';

/** One shared, interruption-safe Floating UI surface per group; triggers own no portals. */
import * as React from 'react';
import { motion, type Transition, type HTMLMotionProps } from 'motion/react';
import {
  useFloating, computePosition, autoUpdate, offset, flip, shift, size, hide, limitShift,
  arrow as floatingArrow, FloatingPortal, FloatingArrow,
  type UseFloatingReturn, type Placement, type MiddlewareData, type Padding,
} from '@floating-ui/react';
import { getStrictContext } from '#zero/lib/get-strict-context';
import { Slot, type WithAsChild } from '#zero/components/animate-ui/primitives/animate/slot';
import { composeOverlayRefs, useOverlayScope, useOverlayTheme, OverlayScopeProvider, useOwnedFloatingOverlay, type OverlayScope } from '../../../overlays/overlay-scope';
import { resolveTooltipMotion } from '../../../tooltip/tooltip-motion';
import { resolveTooltipPlacement } from '../../../tooltip/tooltip-placement';
import {
  playTooltipEnter, playTooltipExit, playTooltipAnimation, cancelTooltipAnimations,
  captureTooltipVisualState, createTooltipSwingController, finishTooltipAnimations,
} from '../../../tooltip/tooltip-motion-runtime';
import type { TooltipMotionOptions } from '../../../tooltip/tooltip-motion-types';
import { emitFrontendCode } from '../../../../frontend/client/observability';
import { OBS_CODES } from '../../../../observability/codes';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';
type TooltipPosition = { x: number; y: number };
type TooltipContentPlacement = {
  side?: Side; sideOffset?: number; align?: Align; alignOffset?: number; collisionPadding?: Padding;
  avoidCollisions?: boolean; collisionBoundary?: Element | null | Array<Element | null>; arrowPadding?: number;
  hideWhenDetached?: boolean; sticky?: 'partial' | 'always'; updatePositionStrategy?: 'optimized' | 'always';
  container?: HTMLElement | null;
};
type TooltipData = {
  contentProps: HTMLMotionProps<'div'>; contentAsChild: boolean; reference: HTMLElement; rect: DOMRect;
  side: Side; sideOffset?: number; align: Align; alignOffset: number; collisionPadding?: Padding;
  avoidCollisions: boolean; id: string; owner: OverlayScope | null; options: TooltipMotionOptions;
  delay?: number; notify: (open: boolean) => void; controlled: boolean; hoverable: boolean;
} & TooltipContentPlacement;
type GlobalTooltipContextType = {
  showTooltip: (data: TooltipData, immediate?: boolean) => void;
  hideTooltip: (id?: string) => void; hideImmediate: (id?: string, force?: boolean) => void;
  refreshPlacement: (id: string, placement: TooltipContentPlacement) => void;
  holdTooltip: (id: string) => void;
  refreshTooltip: (id: string, props: HTMLMotionProps<'div'>, asChild: boolean, options: TooltipMotionOptions) => void;
  currentTooltip: TooltipData | null; transition: Transition; globalId: string;
  setReferenceEl: (el: HTMLElement | null) => void; referenceElRef: React.RefObject<HTMLElement | null>;
  options: TooltipMotionOptions;
};
const [GlobalTooltipProvider, useGlobalTooltip] = getStrictContext<GlobalTooltipContextType>('GlobalTooltipProvider');
type TooltipContextType = {
  propsRef: React.RefObject<HTMLMotionProps<'div'>>; asChildRef: React.RefObject<boolean>;
  contentOptionsRef: React.RefObject<TooltipMotionOptions>;
  optionsRef: React.RefObject<TooltipMotionOptions>; side: Side; sideOffset?: number; align: Align;
  alignOffset: number; collisionPadding?: Padding; avoidCollisions: boolean; id: string;
  open?: boolean; defaultOpen?: boolean; delayDuration?: number; overflowOnly: boolean; notify: (open: boolean) => void;
  disableHoverableContent: boolean;
  contentPlacementRef: React.RefObject<TooltipContentPlacement>;
};
const [LocalTooltipProvider, useTooltip] = getStrictContext<TooltipContextType>('LocalTooltipProvider');
type TooltipProviderProps = TooltipMotionOptions & {
  children: React.ReactNode; id?: string; openDelay?: number; closeDelay?: number; warmDelay?: number;
  /** Legacy layout transition is accepted; tuned motion now comes from shared tokens. */
  transition?: Transition;
};

function TooltipProvider({ children, id, openDelay, closeDelay, warmDelay,
  transition = { duration: .42, ease: [.2, 0, 0, 1] }, ...options }: TooltipProviderProps) {
  const generatedId = React.useId();
  const [currentTooltip, setCurrentTooltip] = React.useState<TooltipData | null>(null);
  const current = React.useRef<TooltipData | null>(null), pending = React.useRef<TooltipData | null>(null);
  const showTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null), hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClose = React.useRef(-Infinity), referenceElRef = React.useRef<HTMLElement | null>(null);
  const config = React.useRef({ openDelay, closeDelay, warmDelay, options });
  config.current = { openDelay, closeDelay, warmDelay, options };
  const clearTimers = React.useCallback(() => {
    if (showTimer.current !== null) clearTimeout(showTimer.current);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    showTimer.current = hideTimer.current = null;
  }, []);
  const close = React.useCallback((target?: string, force = false) => {
    if (target && current.current?.id !== target && pending.current?.id !== target) return;
    clearTimers(); pending.current = null;
    if (current.current?.controlled && !force) { current.current.notify(false); return; }
    const previous = current.current; current.current = null; referenceElRef.current = null;
    if (previous) { previous.notify(false); lastClose.current = performance.now(); setCurrentTooltip(null); }
  }, [clearTimers]);
  const showTooltip = React.useCallback((data: TooltipData, immediate = false) => {
    clearTimers(); if (!data.reference.isConnected || data.owner?.active === false) return;
    pending.current = data;
    const admit = () => {
      const next = pending.current; pending.current = null; showTimer.current = null;
      if (!next || !next.reference.isConnected || next.reference.closest('[inert]') || next.owner?.active === false) return;
      if (current.current?.controlled && current.current.id !== next.id) { current.current.notify(false); return; }
      if (current.current?.id !== next.id) { current.current?.notify(false); next.notify(true); }
      current.current = next; referenceElRef.current = next.reference; setCurrentTooltip(next);
    };
    const profile = resolveTooltipMotion(data.reference, data.options);
    const delay = immediate || current.current || performance.now() - lastClose.current < (config.current.warmDelay ?? profile.timings.warm)
      ? 0 : Math.max(0, data.delay ?? config.current.openDelay ?? profile.timings.openDelay);
    if (!delay) admit(); else showTimer.current = setTimeout(admit, delay);
  }, [clearTimers]);
  const hideTooltip = React.useCallback((target?: string) => {
    if (target && current.current?.id !== target && pending.current?.id !== target) return;
    if (showTimer.current !== null) clearTimeout(showTimer.current); showTimer.current = null; pending.current = null;
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    const data = current.current;
    const delay = config.current.closeDelay ?? resolveTooltipMotion(data?.reference ?? null, data?.options).timings.grace;
    hideTimer.current = setTimeout(() => close(target), Math.max(0, delay));
  }, [close]);
  const refreshTooltip = React.useCallback((target: string, contentProps: HTMLMotionProps<'div'>,
    contentAsChild: boolean, nextOptions: TooltipMotionOptions) => {
    const previous = current.current;
    if (!previous || previous.id !== target || sameContentProps(previous.contentProps, contentProps)
      && previous.contentAsChild === contentAsChild && shallowEqual(previous.options, nextOptions)) return;
    const next = { ...previous, contentProps, contentAsChild, options: nextOptions };
    current.current = next; setCurrentTooltip(next);
  }, []);
  const setReferenceEl = React.useCallback((el: HTMLElement | null) => { referenceElRef.current = el; }, []);
  const holdTooltip = React.useCallback((target: string) => {
    if (current.current?.id !== target) return;
    if (hideTimer.current !== null) clearTimeout(hideTimer.current); hideTimer.current = null;
  }, []);
  const refreshPlacement = React.useCallback((target: string, placement: TooltipContentPlacement) => {
    const previous = current.current;
    if (!previous || previous.id !== target || Object.keys(placement).every(key => Object.is(Reflect.get(previous, key), Reflect.get(placement, key)))) return;
    const next = { ...previous, ...placement }; current.current = next; setCurrentTooltip(next);
  }, []);
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !current.current) return;
      // One Escape dismisses the hint; the next reaches its owning modal.
      event.preventDefault(); event.stopPropagation(); close();
    };
    const dismiss = () => close(undefined, true);
    document.addEventListener('keydown', key, true); window.addEventListener('scroll', dismiss, true); window.addEventListener('resize', dismiss);
    return () => { clearTimers(); current.current?.notify(false); current.current = null;
      document.removeEventListener('keydown', key, true); window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); };
  }, [close, clearTimers]);
  return <GlobalTooltipProvider value={{ showTooltip, hideTooltip, hideImmediate: close, refreshTooltip,
    currentTooltip, transition, globalId: id ?? generatedId, setReferenceEl, referenceElRef, options, refreshPlacement, holdTooltip }}>
    {children}<TooltipOverlay />
  </GlobalTooltipProvider>;
}

type FloatingContextType = { context: UseFloatingReturn['context']; arrowRef: React.RefObject<SVGSVGElement | null>; arrowEnabled: boolean; updateArrow: () => void };
const [FloatingProvider, useFloatingContext] = getStrictContext<FloatingContextType>('FloatingContext');
type TooltipArrowProps = Omit<React.ComponentProps<typeof FloatingArrow>, 'context'> & { withTransition?: boolean };
function TooltipArrow({ ref, withTransition: _legacy, ...props }: TooltipArrowProps) {
  const { context, arrowRef, arrowEnabled, updateArrow } = useFloatingContext();
  React.useImperativeHandle(ref, () => arrowRef.current as SVGSVGElement);
  React.useLayoutEffect(() => { if (arrowEnabled && arrowRef.current) updateArrow(); }, [arrowEnabled, updateArrow, context.elements.floating]);
  if (!arrowEnabled) return null;
  return <FloatingArrow {...props} ref={arrowRef} context={context}
    data-slot="tooltip-arrow" data-side={context.placement.split('-')[0]} />;
}
type Pose = { x: number; y: number; placement: Placement; middlewareData: MiddlewareData };
type Snapshot = { x: number; y: number; width: number; height: number; clone: HTMLElement; textPose: ReturnType<typeof captureTooltipVisualState>; side: Side; arrow?: { left: string; top: string } };
function OwnedTooltipRegistration({ element }: { element: HTMLElement }) {
  const owned = useOwnedFloatingOverlay();
  React.useLayoutEffect(() => { owned.ref(element); return () => { owned.ref(null); }; }, [element, owned.ref]);
  return null;
}
function TooltipOverlay() {
  const { currentTooltip, globalId, hideImmediate, hideTooltip, holdTooltip } = useGlobalTooltip();
  const [rendered, setRendered] = React.useState<TooltipData | null>(null), [pose, setPose] = React.useState<Pose | null>(null);
  const [floatingElement, setFloatingElement] = React.useState<HTMLDivElement | null>(null);
  const renderedRef = React.useRef<TooltipData | null>(null), outer = React.useRef<HTMLDivElement | null>(null);
  const swing = React.useRef<HTMLDivElement | null>(null), inner = React.useRef<HTMLDivElement | null>(null);
  const box = React.useRef<HTMLDivElement | null>(null), text = React.useRef<HTMLDivElement | null>(null);
  const externalContentRef = rendered?.contentProps.ref;
  const mountContent = React.useMemo(() => composeOverlayRefs(box, externalContentRef), [externalContentRef]);
  const arrowRef = React.useRef<SVGSVGElement | null>(null), snapshot = React.useRef<Snapshot | null>(null);
  const epoch = React.useRef(0), positionRevision = React.useRef(0), entered = React.useRef(false);
  const swingController = React.useRef<ReturnType<typeof createTooltipSwingController> | null>(null);
  const theme = useOverlayTheme(rendered?.reference ?? null);
  const { refs, context } = useFloating({ strategy: 'fixed' });
  const mountFloating = React.useCallback((element: HTMLDivElement | null) => { outer.current = element; setFloatingElement(element); }, []);
  const positionUpdate = React.useRef<(() => void) | null>(null);
  const updateArrow = React.useCallback(() => positionUpdate.current?.(), []);
  const stop = React.useCallback(() => {
    swingController.current?.reset(); swingController.current = null;
    if (swing.current) swing.current.style.transform = '';
    for (const el of [outer.current, inner.current, box.current, text.current, arrowRef.current]) if (el) cancelTooltipAnimations(el);
    box.current?.querySelectorAll('[data-zero-tooltip-retiring]').forEach(el => el.remove());
  }, []);
  React.useLayoutEffect(() => {
    const previous = renderedRef.current;
    if (!currentTooltip) {
      if (!previous || !inner.current) return;
      const generation = ++epoch.current, visual = inner.current;
      swingController.current?.stop(); swingController.current = null;
      const resolved = resolveTooltipMotion(visual, previous.options);
      const side = (pose?.placement.split('-')[0] ?? previous.side) as Side;
      void playTooltipExit(visual, resolved, side).finished.then(() => {
        if (generation !== epoch.current) return;
        stop(); entered.current = false; snapshot.current = null; renderedRef.current = null; setRendered(null); setPose(null);
      }); return;
    }
    ++epoch.current;
    const resolved = resolveTooltipMotion(currentTooltip.reference, currentTooltip.options);
    const previousResolved = previous ? resolveTooltipMotion(previous.reference, previous.options) : null;
    if (previous && previous.id !== currentTooltip.id && outer.current && box.current && text.current
      && previousResolved?.motion === resolved.motion && resolved.motion !== 'swing' && !resolved.reducedMotion) {
      const rect = outer.current.getBoundingClientRect(), b = box.current.getBoundingClientRect();
      const clone = text.current.cloneNode(true) as HTMLElement;
      clone.setAttribute('aria-hidden', 'true'); clone.setAttribute('data-zero-tooltip-retiring', '');
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      clone.querySelectorAll('[data-slot="tooltip-arrow"]').forEach(el => el.remove());
      snapshot.current = { x: rect.x, y: rect.y, width: b.width, height: b.height, clone, textPose: captureTooltipVisualState(text.current),
        side: (pose?.placement.split('-')[0] ?? previous.side) as Side,
        ...(arrowRef.current ? { arrow: { left: getComputedStyle(arrowRef.current).left, top: getComputedStyle(arrowRef.current).top } } : {}) };
    } else { snapshot.current = null; if (previous?.id !== currentTooltip.id) entered.current = false; }
    const visual = inner.current ? captureTooltipVisualState(inner.current) : null;
    stop();
    if (visual && inner.current && previous) {
      inner.current.style.transform = visual.transform; inner.current.style.opacity = visual.opacity;
      inner.current.style.filter = visual.filter;
    }
    renderedRef.current = currentTooltip; setRendered(currentTooltip);
  }, [currentTooltip, stop]);
  React.useLayoutEffect(() => {
    if (!rendered || !outer.current || !box.current || !inner.current || !text.current || !swing.current) return;
    if (!rendered.reference.isConnected || rendered.owner?.active === false) { hideImmediate(rendered.id, true); return; }
    const generation = epoch.current, anchor = rendered.reference, floating = outer.current, b = box.current, visual = inner.current, textElement = text.current;
    refs.setReference(anchor); refs.setFloating(floating);
    const resolved = resolveTooltipMotion(anchor, rendered.options), arrowEnabled = resolved.arrow;
    const padding = rendered.collisionPadding ?? resolved.geometry.viewportPadding;
    const controller = new AbortController();
    let readableSidePromise: Promise<Side> | undefined;
    let failed = false;
    const position = async (revision: number) => {
      if (!anchor.isConnected || anchor.closest('[inert]')) { hideImmediate(rendered.id, true); return; }
      const mainOffset = rendered.sideOffset ?? (arrowEnabled ? resolved.geometry.gap : resolved.geometry.gapWithoutArrow);
      if (!readableSidePromise) {
        // Probe once per content/theme target, not during every size-animation
        // observation: clearing constraints each frame causes resize feedback.
        const naturalStyle = rendered.contentProps.style;
        for (const name of ['width', 'height', 'maxWidth', 'maxHeight'] as const) {
          const value = naturalStyle?.[name]; b.style[name] = typeof value === 'number' ? `${value}px` : typeof value === 'string' ? value : '';
        }
        floating.style.maxWidth = ''; floating.style.maxHeight = '';
        b.style.removeProperty('--radix-tooltip-content-available-width');
        b.style.removeProperty('--radix-tooltip-content-available-height');
        readableSidePromise = rendered.avoidCollisions ? resolveTooltipPlacement(anchor, b, { side: rendered.side,
          align: rendered.align, sideOffset: mainOffset, collisionBoundary: rendered.collisionBoundary,
          collisionPadding: padding, signal: controller.signal }) : Promise.resolve(rendered.side);
      }
      const readableSide = await readableSidePromise;
      if (controller.signal.aborted || generation !== epoch.current || revision !== positionRevision.current || renderedRef.current !== rendered) return;
      const placement: Placement = rendered.align === 'center' ? readableSide : `${readableSide}-${rendered.align}`;
      const boundary = Array.isArray(rendered.collisionBoundary) ? rendered.collisionBoundary.filter((element): element is Element => element !== null)
        : rendered.collisionBoundary ?? 'clippingAncestors';
      const middleware = [offset({ mainAxis: mainOffset, crossAxis: rendered.alignOffset }),
        ...(rendered.avoidCollisions ? [flip({ padding, boundary, fallbackAxisSideDirection: 'start' }), shift({ padding, boundary,
          ...(rendered.sticky !== 'always' ? { limiter: limitShift() } : {}) }), size({ padding, boundary,
          apply({ availableWidth, availableHeight }) {
            const width = `${Math.max(0, availableWidth)}px`, height = `${Math.max(0, availableHeight)}px`;
            floating.style.maxWidth = width; floating.style.maxHeight = height; b.style.maxWidth = width;
            // The common themed body owns scroll capping; share Radix's existing
            // available-space contract rather than capping only an outer shell.
            b.style.setProperty('--radix-tooltip-content-available-width', width);
            b.style.setProperty('--radix-tooltip-content-available-height', height);
          } })] : []),
        ...(arrowEnabled ? [floatingArrow({ element: arrowRef.current, padding: rendered.arrowPadding ?? 8 })] : []),
        ...(rendered.hideWhenDetached ? [hide({ boundary })] : [])];
      const next = await computePosition(anchor, floating, { strategy: 'fixed', placement, middleware });
      if (generation !== epoch.current || revision !== positionRevision.current || renderedRef.current !== rendered || !floating.isConnected) return;
      if (next.middlewareData.hide?.referenceHidden) { hideImmediate(rendered.id, true); return; }
      const side = next.placement.split('-')[0] as Side, width = b.offsetWidth, height = b.offsetHeight;
      const coordinate = next.middlewareData.arrow;
      const centerX = coordinate?.x != null ? coordinate.x + (arrowRef.current?.getBoundingClientRect().width ?? resolved.geometry.arrowSize) / 2 : width / 2;
      const centerY = coordinate?.y != null ? coordinate.y + (arrowRef.current?.getBoundingClientRect().height ?? resolved.geometry.arrowSize) / 2 : height / 2;
      const extension = arrowEnabled ? resolved.geometry.arrowOriginOffset : 0;
      const origin = side === 'top' ? `${centerX}px ${height + extension}px` : side === 'bottom' ? `${centerX}px ${-extension}px`
        : side === 'left' ? `${width + extension}px ${centerY}px` : `${-extension}px ${centerY}px`;
      visual.style.transformOrigin = origin; floating.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
      floating.style.visibility = 'visible'; setPose(next);
      const from = snapshot.current; snapshot.current = null;
      if (from) {
        playTooltipAnimation(visual, [{ transform: visual.style.transform || 'none', opacity: visual.style.opacity || '1', filter: visual.style.filter || 'none' },
          { transform: 'none', opacity: 1, filter: 'none' }], { duration: resolved.timings.morphMove, easing: resolved.easing.out });
        visual.style.transform = ''; visual.style.opacity = ''; visual.style.filter = '';
        const duration = resolved.timings.morphMove, dir = Math.sign(next.x + width / 2 - from.x - from.width / 2) || 1, clone = from.clone;
        Object.assign(clone.style, { position: 'absolute', top: '0px', left: '0px', width: `${from.width}px`, pointerEvents: 'none' }); b.append(clone);
        playTooltipAnimation(floating, [{ transform: `translate3d(${from.x}px,${from.y}px,0)` }, { transform: `translate3d(${next.x}px,${next.y}px,0)` }], { duration, easing: resolved.easing.out });
        playTooltipAnimation(b, [{ width: `${from.width}px`, height: `${from.height}px` }, { width: `${width}px`, height: `${height}px` }], { duration, easing: resolved.easing.out });
        playTooltipAnimation(clone, [{ ...from.textPose }, { opacity: 0,
          transform: `translateX(${-dir * resolved.geometry.morphTextOutX}px)`, filter: `blur(${resolved.geometry.morphTextBlur}px)` }],
          { duration: resolved.timings.morphTextOut, easing: resolved.easing.out, fill: 'forwards' });
        const animation = playTooltipAnimation(textElement, [{ opacity: 0, transform: `translateX(${dir * resolved.geometry.morphTextInX}px)`, filter: `blur(${resolved.geometry.morphTextBlur}px)` },
          { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: resolved.timings.morphTextIn, delay: resolved.timings.morphTextDelay, easing: resolved.easing.out, fill: 'backwards' });
        void animation?.finished.then(() => { if (generation === epoch.current) clone.remove(); }).catch(() => {});
        if (from.arrow && arrowRef.current && from.side === side) {
          const a = arrowRef.current, to = side === 'top' || side === 'bottom' ? { left: `${coordinate?.x ?? 0}px`, top: a.style.top } : { left: a.style.left, top: `${coordinate?.y ?? 0}px` };
          playTooltipAnimation(a, [from.arrow, to], { duration, easing: resolved.easing.out });
        }
      } else if (!entered.current || visual.style.transform || visual.style.opacity || visual.style.filter) {
        entered.current = true;
        const seed = visual.style.transform || visual.style.opacity || visual.style.filter ? captureTooltipVisualState(visual) : null;
        visual.style.opacity = ''; visual.style.transform = ''; visual.style.filter = '';
        playTooltipEnter(visual, resolved, side, origin, seed ?? undefined);
        if (resolved.motion === 'swing') swingController.current = createTooltipSwingController(swing.current!, resolved);
      }
    };
    const update = async () => {
      const revision = ++positionRevision.current;
      if (failed || controller.signal.aborted) return;
      try { await position(revision); } catch {
        if (controller.signal.aborted || generation !== epoch.current || revision !== positionRevision.current
          || renderedRef.current !== rendered || !anchor.isConnected || !floating.isConnected) return;
        failed = true;
        emitFrontendCode(OBS_CODES.FRONTEND_TOOLTIP_PLACEMENT_FAILED, {
          metadata: { surface: 'tooltip', stage: 'grouped-placement', side: ['top', 'right', 'bottom', 'left'].includes(rendered.side) ? rendered.side : 'unknown' },
        });
        hideImmediate(rendered.id, true);
      }
    };
    positionUpdate.current = () => { void update(); };
    const cleanup = autoUpdate(anchor, floating, update, { ancestorScroll: false, ancestorResize: false, animationFrame: rendered.updatePositionStrategy === 'always' });
    const track = (event: PointerEvent) => { if (event.pointerType !== 'touch') swingController.current?.track(anchor, event.clientX); };
    anchor.addEventListener('pointermove', track, { passive: true });
    return () => { controller.abort(); positionUpdate.current = null; cleanup(); anchor.removeEventListener('pointermove', track); };
  }, [rendered, floatingElement, theme, refs, hideImmediate]);
  React.useEffect(() => () => { ++epoch.current; stop(); }, [stop]);
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => {
      if (!media.matches) return;
      swingController.current?.reset(); swingController.current = null;
      for (const element of [outer.current, inner.current, box.current, text.current, arrowRef.current]) if (element) finishTooltipAnimations(element);
    };
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  if (!rendered) return null;
  const { children, style, ...contentProps } = rendered.contentProps;
  const customLayer = typeof style?.zIndex === 'number' || typeof style?.zIndex === 'string' ? style.zIndex : undefined;
  const Component = rendered.contentAsChild ? Slot : motion.div;
  const side = (pose?.placement.split('-')[0] ?? rendered.side) as Side;
  const appearance = resolveTooltipMotion(rendered.reference, rendered.options);
  if (rendered.container && rendered.container.ownerDocument !== rendered.reference.ownerDocument) throw new TypeError('Tooltip container must belong to the trigger document.');
  const boundaries = Array.isArray(rendered.collisionBoundary) ? rendered.collisionBoundary : [rendered.collisionBoundary];
  if (boundaries.some(element => element && element.ownerDocument !== rendered.reference.ownerDocument)) throw new TypeError('Tooltip collision boundaries must belong to the trigger document.');
  return <FloatingPortal id={`zero-tooltip-${globalId}`} root={rendered.container ?? rendered.owner?.container}><div ref={mountFloating} data-slot="tooltip-overlay" data-zero-tooltip-shared="true" data-side={side}
    data-state={currentTooltip ? 'open' : 'closed'} data-zero-overlay-owner={rendered.owner?.id}
    onPointerEnter={() => { if (rendered.hoverable) holdTooltip(rendered.id); }}
    onPointerLeave={() => { if (rendered.hoverable) hideTooltip(rendered.id); }}
    style={{ ...rendered.owner?.themeStyle, ...theme, position: 'fixed', left: 0, top: 0, visibility: pose ? 'visible' : 'hidden',
      zIndex: rendered.owner ? rendered.owner.zIndex + 2 : customLayer ?? 'var(--zero-tooltip-layer-base, 50)', pointerEvents: rendered.hoverable && currentTooltip ? 'auto' : 'none',
      ...(rendered.owner?.active === false ? { display: 'none' } : {}) }}>
    {currentTooltip && rendered.owner && floatingElement && <OverlayScopeProvider value={rendered.owner}>
      <OwnedTooltipRegistration element={floatingElement} />
    </OverlayScopeProvider>}
    <div ref={swing} data-slot="tooltip-swing"><div ref={inner} data-slot="tooltip-motion">
      <FloatingProvider value={{ context: { ...context, placement: pose?.placement ?? rendered.side, middlewareData: pose?.middlewareData ?? {} }, arrowRef, arrowEnabled: appearance.arrow, updateArrow }}>
        <Component {...contentProps} ref={mountContent} id={rendered.contentProps.id ?? rendered.id} role="tooltip" data-slot="tooltip-content" data-zero-tooltip="" data-arrow={appearance.arrow}
          data-zero-overlay-owner={rendered.owner?.id}
            data-side={side} data-align={rendered.align} data-state={currentTooltip ? 'open' : 'closed'} data-motion={appearance.motion} data-variant={appearance.variant}
          style={{ position: 'relative', ...style, ...(rendered.owner ? { zIndex: rendered.owner.zIndex + 2 } : {}) }}>
          {rendered.contentAsChild && React.isValidElement<{ children?: React.ReactNode }>(children)
            ? React.cloneElement(children, { children: <div ref={text} data-slot="tooltip-text">{children.props.children}</div> })
            : <div ref={text} data-slot="tooltip-text">{children as React.ReactNode}</div>}
        </Component>
      </FloatingProvider>
    </div></div>
  </div></FloatingPortal>;
}

type TooltipProps = TooltipMotionOptions & {
  children: React.ReactNode; side?: Side; sideOffset?: number; align?: Align; alignOffset?: number;
  collisionPadding?: Padding; avoidCollisions?: boolean; open?: boolean; defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void; delayDuration?: number; overflowOnly?: boolean;
  disableHoverableContent?: boolean;
};
function Tooltip({ children, side = 'top', sideOffset, align = 'center', alignOffset = 0, collisionPadding,
  avoidCollisions = true, open, defaultOpen, onOpenChange, delayDuration, overflowOnly = false, disableHoverableContent = true, ...options }: TooltipProps) {
  const id = React.useId(), propsRef = React.useRef<HTMLMotionProps<'div'>>({}), asChildRef = React.useRef(false);
  const explicitOptions = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as TooltipMotionOptions;
  const optionsRef = React.useRef<TooltipMotionOptions>(explicitOptions); optionsRef.current = explicitOptions;
  const contentOptionsRef = React.useRef<TooltipMotionOptions>({});
  const contentPlacementRef = React.useRef<TooltipContextType['contentPlacementRef']['current']>({});
  const callback = React.useRef(onOpenChange); callback.current = onOpenChange;
  const authority = React.useRef(open); authority.current = open;
  const lastNotified = React.useRef(open ?? defaultOpen ?? false);
  const notify = React.useCallback((value: boolean) => {
    if (authority.current !== undefined) { if (value !== authority.current) callback.current?.(value); return; }
    if (lastNotified.current === value) return; lastNotified.current = value; callback.current?.(value);
  }, []);
  return <LocalTooltipProvider value={{ propsRef, asChildRef, optionsRef, side, sideOffset, align, alignOffset,
    collisionPadding, avoidCollisions, id, open, defaultOpen, delayDuration, overflowOnly, notify, contentPlacementRef, contentOptionsRef, disableHoverableContent }}>{children}</LocalTooltipProvider>;
}
type TooltipContentProps = WithAsChild<HTMLMotionProps<'div'>> & TooltipMotionOptions;
function shallowEqual(a: object, b: object) {
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.is(Reflect.get(a, key), Reflect.get(b, key)));
}
/** Context handoff rerenders the same React content; equivalent element trees are not new records. */
function sameContentValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => sameContentValue(item, b[index]));
  if (React.isValidElement(a) && React.isValidElement(b)) return a.type === b.type && a.key === b.key
    && sameContentProps(a.props as object, b.props as object);
  return false;
}
function sameContentProps(a: object, b: object): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => key === 'children'
    ? sameContentValue(Reflect.get(a, key), Reflect.get(b, key))
    : key === 'style' && Reflect.get(a, key) && Reflect.get(b, key)
      ? shallowEqual(Reflect.get(a, key), Reflect.get(b, key)) : Object.is(Reflect.get(a, key), Reflect.get(b, key)));
}
function TooltipContent({ asChild = false, motion: preset, durationMultiplier, arrow, variant, ...props }: TooltipContentProps) {
  const local = useTooltip(), global = useGlobalTooltip();
  React.useLayoutEffect(() => {
    local.propsRef.current = props; local.asChildRef.current = asChild;
    const contentOptions = { ...(preset !== undefined ? { motion: preset } : {}),
      ...(durationMultiplier !== undefined ? { durationMultiplier } : {}), ...(arrow !== undefined ? { arrow } : {}), ...(variant !== undefined ? { variant } : {}) };
    local.contentOptionsRef.current = contentOptions;
    const options = { ...global.options, ...local.optionsRef.current, ...contentOptions };
    global.refreshTooltip(local.id, props, asChild, options);
  }); return null;
}
type TooltipTriggerProps = WithAsChild<HTMLMotionProps<'div'>>;
function TooltipTrigger({ ref, asChild = false, children, ...props }: TooltipTriggerProps) {
  const local = useTooltip(), global = useGlobalTooltip(), owner = useOverlayScope();
  const triggerRef = React.useRef<HTMLDivElement | null>(null), suppressFocus = React.useRef(false);
  const mountTrigger = React.useMemo(() => composeOverlayRefs(triggerRef, ref), [ref]);
  const latest = React.useRef({ local, global, owner }); latest.current = { local, global, owner };
  const readData = React.useCallback((): TooltipData | null => {
    const { local: l, global: g, owner: o } = latest.current, reference = triggerRef.current;
    if (!reference || o?.active === false || reference.closest('[inert]')) return null;
    if (l.overflowOnly && reference.scrollWidth <= reference.clientWidth && reference.scrollHeight <= reference.clientHeight) return null;
    return { contentProps: l.propsRef.current, contentAsChild: l.asChildRef.current, reference, rect: reference.getBoundingClientRect(),
      side: l.side, sideOffset: l.sideOffset, align: l.align, alignOffset: l.alignOffset, collisionPadding: l.collisionPadding,
      avoidCollisions: l.avoidCollisions, ...l.contentPlacementRef.current, id: l.id, owner: o, options: { ...g.options, ...l.optionsRef.current, ...l.contentOptionsRef.current }, delay: l.delayDuration, notify: l.notify, controlled: l.open === true, hoverable: !l.disableHoverableContent };
  }, []);
  const requestOpen = React.useCallback((immediate = false) => {
    const data = readData(); if (!data) return;
    if (latest.current.local.open === false) { data.notify(true); return; }
    latest.current.global.showTooltip(data, immediate);
  }, [readData]);
  React.useEffect(() => {
    if (owner?.active === false || local.open === false) global.hideImmediate(local.id, true);
    else if (local.open === true || local.defaultOpen && !global.currentTooltip) requestOpen(true);
  }, [local.open, owner?.active]);
  React.useEffect(() => () => latest.current.global.hideImmediate(latest.current.local.id, true), []);
  const childProps = asChild && React.isValidElement(children) ? children.props as HTMLMotionProps<'div'> : null;
  const call = <K extends keyof HTMLMotionProps<'div'>>(key: K, event: unknown) => {
    const child = childProps?.[key], own = Reflect.get(props, key);
    if (typeof child === 'function') (child as (event: unknown) => void)(event);
    if (typeof own === 'function') (own as (event: unknown) => void)(event);
  };
  const handlers = {
    onPointerEnter(event: React.PointerEvent<HTMLDivElement>) { call('onPointerEnter', event); if (!event.defaultPrevented && event.pointerType !== 'touch') requestOpen(); },
    onPointerLeave(event: React.PointerEvent<HTMLDivElement>) { call('onPointerLeave', event); if (!event.defaultPrevented) global.hideTooltip(local.id); },
    onPointerDown(event: React.PointerEvent<HTMLDivElement>) { call('onPointerDown', event); suppressFocus.current = true; global.hideImmediate(local.id); },
    onFocus(event: React.FocusEvent<HTMLDivElement>) { call('onFocus', event); if (!event.defaultPrevented && !suppressFocus.current && event.currentTarget.matches(':focus-visible')) requestOpen(true); },
    onBlur(event: React.FocusEvent<HTMLDivElement>) { call('onBlur', event); suppressFocus.current = false; global.hideTooltip(local.id); },
  };
  const described = [childProps?.['aria-describedby'], props['aria-describedby'], global.currentTooltip?.id === local.id ? local.propsRef.current.id ?? local.id : null]
    .filter(Boolean).join(' ').split(/\s+/).filter((value, index, list) => value && list.indexOf(value) === index).join(' ') || undefined;
  const Component = asChild ? Slot : motion.div;
  return <Component {...props} {...handlers} ref={mountTrigger} data-slot="tooltip-trigger" data-side={local.side}
    data-align={local.align} data-state={global.currentTooltip?.id === local.id ? 'open' : 'closed'} aria-describedby={described}>{children}</Component>;
}
export { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger, TooltipArrow, useGlobalTooltip, useTooltip,
  type TooltipProviderProps, type TooltipProps, type TooltipContentProps, type TooltipTriggerProps, type TooltipArrowProps,
  type TooltipPosition, type GlobalTooltipContextType, type TooltipContextType };
export type { TooltipContentPlacement };
