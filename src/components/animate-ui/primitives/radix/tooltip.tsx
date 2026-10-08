'use client';

/**
 * Radix owns activation, descriptions, placement and dismissal. This adapter
 * owns scoped tooltip paint and interruption-safe reference motion, not focus.
 * Group handoff reuses the existing Floating UI family.
 */
import * as React from 'react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { motion, useMotionValue, useSpring, type SpringOptions, type HTMLMotionProps, type MotionValue } from 'motion/react';
import { getStrictContext } from '#zero/lib/get-strict-context';
import { useControlledState } from '#zero/hooks/use-controlled-state';
import { useDataState } from '#zero/hooks/use-data-state';
import { useMediaQuery } from '../../../../hooks/use-media-query';
import { composeOverlayRefs, useOverlayScope, useOverlayTheme } from '../../../overlays/overlay-scope';
import { hasTooltipOverflow, hasTooltipKeyboardFocus, mergeTooltipDescription } from '../../../tooltip/tooltip-activation';
import { resolveTooltipMotion } from '../../../tooltip/tooltip-motion';
import { resolveTooltipPlacement } from '../../../tooltip/tooltip-placement';
import { emitFrontendCode } from '../../../../frontend/client/observability';
import { OBS_CODES } from '../../../../observability/codes';
import type { TooltipMotionOptions } from '../../../tooltip/tooltip-motion-types';
import { playTooltipEnter, playTooltipExit, createTooltipSwingController, cancelTooltipAnimations } from '../../../tooltip/tooltip-motion-runtime';

type TooltipProviderProps = React.ComponentProps<typeof RadixTooltip.Provider> & TooltipMotionOptions & { closeDelay?: number };
type ProviderSettings = TooltipMotionOptions & { closeDelay?: number; delayDuration?: number; skipDelayDuration?: number };
const ProviderContext = React.createContext<ProviderSettings | null>(null);

/** Share hover intent and presentation; individual roots also work without a provider. */
function TooltipProvider({ children, delayDuration, skipDelayDuration, closeDelay,
  motion: preset, durationMultiplier, arrow, variant, disableHoverableContent = true, ...props }: TooltipProviderProps) {
  const settings = React.useMemo(() => ({ motion: preset, durationMultiplier, arrow, variant, closeDelay, delayDuration, skipDelayDuration }),
    [preset, durationMultiplier, arrow, variant, closeDelay, delayDuration, skipDelayDuration]);
  const defaults = resolveTooltipMotion(typeof document === 'undefined' ? null : document.documentElement).timings;
  return <ProviderContext.Provider value={settings}><RadixTooltip.Provider delayDuration={delayDuration ?? defaults.openDelay}
    skipDelayDuration={skipDelayDuration ?? defaults.warm} disableHoverableContent={disableHoverableContent} {...props}>{children}</RadixTooltip.Provider></ProviderContext.Provider>;
}

/** Read optional outer defaults when composing the explicit shared-tooltip adapter. */
function useTooltipProviderSettings() { return React.useContext(ProviderContext); }

type TooltipContextType = {
  isOpen: boolean; setIsOpen: (open: boolean) => void; dismiss: () => void;
  x: MotionValue<number>; y: MotionValue<number>; followCursor?: boolean | 'x' | 'y';
  followCursorSpringOptions?: SpringOptions; options: TooltipMotionOptions;
  trigger: HTMLElement | null; setTrigger: (element: HTMLElement | null) => void; overflowOnly: boolean;
};
const [LocalTooltipProvider, useTooltip] = getStrictContext<TooltipContextType>('TooltipContext');
type TooltipProps = React.ComponentProps<typeof RadixTooltip.Root> & TooltipMotionOptions & {
  followCursor?: boolean | 'x' | 'y'; followCursorSpringOptions?: SpringOptions;
  /** Only open when trigger content is actually clipped. */
  overflowOnly?: boolean;
};

/** Compose controlled/uncontrolled state without replacing Radix interactions. */
function Tooltip(props: TooltipProps) {
  const inherited = React.useContext(ProviderContext);
  return inherited ? <TooltipRoot {...props} /> : <TooltipProvider><TooltipRoot {...props} /></TooltipProvider>;
}

function TooltipRoot({ followCursor = false, followCursorSpringOptions = { stiffness: 200, damping: 17 },
  overflowOnly = false, motion: preset, durationMultiplier, arrow, variant,
  open, defaultOpen = false, onOpenChange, ...props }: TooltipProps) {
  const inherited = React.useContext(ProviderContext)!;
  const owner = useOverlayScope();
  const [requestedOpen, setRequestedOpen] = useControlledState({ value: open, defaultValue: defaultOpen, onChange: onOpenChange });
  const [trigger, setTrigger] = React.useState<HTMLElement | null>(null);
  const hoverIntent = resolveTooltipMotion(trigger).timings;
  const closeGrace = inherited.closeDelay ?? hoverIntent.grace;
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isOpen = requestedOpen && (!owner || owner.active) && (!overflowOnly || hasTooltipOverflow(trigger));
  const x = useMotionValue(0), y = useMotionValue(0);
  const dismiss = React.useCallback(() => { clearTimeout(timer.current); setRequestedOpen(false); }, [setRequestedOpen]);
  const setIsOpen = React.useCallback((next: boolean) => {
    clearTimeout(timer.current);
    if (next) {
      if ((!owner || owner.active) && (!overflowOnly || hasTooltipOverflow(trigger))) setRequestedOpen(true);
    } else if (closeGrace > 0) timer.current = setTimeout(() => setRequestedOpen(false), closeGrace);
    else setRequestedOpen(false);
  }, [owner, overflowOnly, trigger, closeGrace, setRequestedOpen]);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  React.useEffect(() => {
    if (!trigger || !overflowOnly) return;
    const check = () => { if (!hasTooltipOverflow(trigger)) dismiss(); };
    const observer = new ResizeObserver(check), changes = new MutationObserver(check);
    observer.observe(trigger); changes.observe(trigger, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); changes.disconnect(); };
  }, [trigger, overflowOnly, dismiss]);
  React.useEffect(() => { if (owner && !owner.active && requestedOpen) dismiss(); }, [owner?.active, requestedOpen, dismiss]);
  const options = React.useMemo(() => ({
    motion: preset ?? inherited.motion, durationMultiplier: durationMultiplier ?? inherited.durationMultiplier,
    arrow: arrow ?? inherited.arrow, variant: variant ?? inherited.variant,
  }), [preset, durationMultiplier, arrow, variant, inherited]);
  return <LocalTooltipProvider value={{ isOpen, setIsOpen, dismiss, x, y, followCursor,
    followCursorSpringOptions, options, trigger, setTrigger, overflowOnly }}>
    <RadixTooltip.Root {...props} delayDuration={props.delayDuration ?? inherited.delayDuration ?? hoverIntent.openDelay}
      open={isOpen} onOpenChange={setIsOpen} />
  </LocalTooltipProvider>;
}

type TooltipTriggerProps = React.ComponentProps<typeof RadixTooltip.Trigger>;

/** Compose consumer refs/handlers, retaining external accessible descriptions. */
function TooltipTrigger({ ref, onMouseMove, onFocus, onPointerDown, children, asChild,
  'aria-describedby': describedBy, ...props }: TooltipTriggerProps) {
  const { x, y, followCursor, isOpen, setTrigger, dismiss } = useTooltip();
  const elementRef = React.useRef<HTMLElement | null>(null);
  const child = asChild && React.isValidElement<Record<string, unknown>>(children) ? children : null;
  const childWithoutDescription = child ? (() => {
    const { 'aria-describedby': _description, ...childProps } = child.props;
    return React.createElement(child.type, { ...childProps, key: child.key });
  })() : null;
  const existing = mergeTooltipDescription(describedBy, typeof child?.props['aria-describedby'] === 'string'
    ? child.props['aria-describedby'] : undefined);
  const mergedRef = React.useMemo(() => composeOverlayRefs<HTMLElement>(elementRef, setTrigger,
    ref as React.Ref<HTMLElement>), [setTrigger, ref]);
  React.useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const externalIds = new Set(existing?.split(/\s+/u));
    let tooltipId: string | undefined;
    const sync = () => {
      const value = element.getAttribute('aria-describedby');
      if (isOpen) tooltipId = value?.split(/\s+/u).find(id => !externalIds.has(id)) ?? tooltipId;
      const next = mergeTooltipDescription(existing, isOpen ? tooltipId : undefined);
      if (next !== (value ?? undefined)) {
        if (next) element.setAttribute('aria-describedby', next); else element.removeAttribute('aria-describedby');
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(element, { attributes: true, attributeFilter: ['aria-describedby'] });
    return () => observer.disconnect();
  }, [existing, isOpen]);
  return <RadixTooltip.Trigger data-slot="tooltip-trigger" {...props} asChild={asChild}
    ref={mergedRef as React.Ref<HTMLButtonElement>}
    onMouseMove={event => {
      onMouseMove?.(event);
      if (event.defaultPrevented) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (followCursor === 'x' || followCursor === true) x.set((event.clientX - rect.left - rect.width / 2) / 2);
      if (followCursor === 'y' || followCursor === true) y.set((event.clientY - rect.top - rect.height / 2) / 2);
    }}
    onFocus={event => { onFocus?.(event); if (!hasTooltipKeyboardFocus(event.currentTarget)) event.preventDefault(); }}
    onPointerDown={event => { onPointerDown?.(event); if (!event.defaultPrevented) dismiss(); }}>
    {childWithoutDescription ?? children}
  </RadixTooltip.Trigger>;
}

type TooltipPortalProps = Omit<React.ComponentProps<typeof RadixTooltip.Portal>, 'forceMount'>;
/** Escape clipping without leaving the tooltip's React owner or theme lane. */
function TooltipPortal({ container, ...props }: TooltipPortalProps) {
  const owner = useOverlayScope();
  const { trigger } = useTooltip();
  const target = container ?? owner?.container;
  if (target && trigger && target.ownerDocument !== trigger.ownerDocument) throw new TypeError('Tooltip portal must use the trigger document.');
  return <RadixTooltip.Portal forceMount container={target} {...props} />;
}

type TooltipContentProps = Omit<React.ComponentProps<typeof RadixTooltip.Content>, 'forceMount' | 'asChild'> &
  HTMLMotionProps<'div'> & TooltipMotionOptions;

/** Retain retiring paint for exit; the tooltip never owns a focus trap. */
function TooltipContent({ 'aria-label': ariaLabel, dir, onEscapeKeyDown, onPointerDownOutside,
  side = 'top', sideOffset, align, alignOffset, avoidCollisions, collisionBoundary, collisionPadding,
  arrowPadding, sticky, hideWhenDetached, updatePositionStrategy, style,
  motion: preset, durationMultiplier, arrow, variant, transition: _legacyTransition,
  ref: forwardedRef, ...props }: TooltipContentProps) {
  const { isOpen, dismiss, trigger, options, x, y, followCursor, followCursorSpringOptions } = useTooltip();
  const owner = useOverlayScope(), inheritedTheme = useOverlayTheme(trigger);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { initializeWithValue: true });
  const translateX = useSpring(x, followCursorSpringOptions), translateY = useSpring(y, followCursorSpringOptions);
  const [present, setPresent] = React.useState(isOpen);
  const [element, setElement] = React.useState<HTMLDivElement | null>(null);
  const [admittedSide, setAdmittedSide] = React.useState(side);
  const [boundaryReady, setBoundaryReady] = React.useState(!collisionBoundary);
  React.useLayoutEffect(() => {
    if (!collisionBoundary || avoidCollisions === false) {
      setAdmittedSide(side); setBoundaryReady(true); return;
    }
    if (!element || !trigger) return;
    const controller = new AbortController();
    const view = trigger.ownerDocument.defaultView!;
    let frame = 0;
    setBoundaryReady(false);
    void resolveTooltipPlacement(trigger, element, { side, align, sideOffset, collisionBoundary,
      collisionPadding, signal: controller.signal }).then(next => {
      if (controller.signal.aborted) return;
      setAdmittedSide(next);
      // Let Radix resolve final coordinates and arrow-tip origin before entrance.
      frame = view.requestAnimationFrame(() => {
        frame = view.requestAnimationFrame(() => { if (!controller.signal.aborted) setBoundaryReady(true); });
      });
    }).catch(() => {
      if (controller.signal.aborted) return;
      emitFrontendCode(OBS_CODES.FRONTEND_TOOLTIP_PLACEMENT_FAILED, { metadata: { surface: 'tooltip', stage: 'standalone-placement' } });
      setAdmittedSide(side); setBoundaryReady(true);
    });
    return () => { controller.abort(); view.cancelAnimationFrame(frame); };
  }, [element, trigger, side, align, sideOffset, collisionBoundary, collisionPadding, avoidCollisions]);
  const [accessibleText, setAccessibleText] = React.useState(' ');
  React.useLayoutEffect(() => {
    if (!element || ariaLabel) return;
    const read = () => setAccessibleText(element.textContent?.trim() || ' ');
    read();
    const observer = new MutationObserver(read);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [element, ariaLabel]);
  const [resolvedSide, sideRef] = useDataState<HTMLDivElement>('side');
  const [resolvedAlign, alignRef] = useDataState<HTMLDivElement>('align');
  const positioningRef = React.useMemo(() => composeOverlayRefs(sideRef, alignRef), [sideRef, alignRef]);
  const visualRef = React.useMemo(() => composeOverlayRefs<HTMLDivElement>(setElement, forwardedRef), [forwardedRef]);
  const resolved = resolveTooltipMotion(trigger, { ...options,
    ...(preset !== undefined ? { motion: preset } : {}), ...(durationMultiplier !== undefined ? { durationMultiplier } : {}),
    ...(arrow !== undefined ? { arrow } : {}), ...(variant !== undefined ? { variant } : {}) }, reducedMotion ?? undefined);
  const layer = owner?.zIndex !== undefined ? owner.zIndex + 2 : style?.zIndex ?? 'var(--zero-tooltip-layer-base, 50)';
  const openRef = React.useRef(isOpen); openRef.current = isOpen;
  React.useLayoutEffect(() => { if (isOpen) setPresent(true); }, [isOpen]);
  const settingsKey = JSON.stringify(resolved);
  React.useLayoutEffect(() => {
    if (!element || !boundaryReady) return;
    let stopped = false;
    const view = element.ownerDocument.defaultView!;
    const frame = view.requestAnimationFrame(() => {
      if (stopped) return;
      const actualSide = (element.parentElement?.getAttribute('data-side') ?? side) as 'top' | 'bottom' | 'left' | 'right';
      const origin = view.getComputedStyle(element.parentElement!).getPropertyValue('--radix-popper-transform-origin');
      const animation = isOpen ? playTooltipEnter(element, resolved, actualSide, origin)
        : playTooltipExit(element, resolved, actualSide, origin);
      if (!isOpen) void animation.finished.then(() => { if (!stopped && !openRef.current) setPresent(false); });
    });
    // The next effect captures this composited pose before replacing owned motion.
    // Cleanup must not cancel it first, which would snap close/reopen to the target.
    return () => { stopped = true; view.cancelAnimationFrame(frame); };
  }, [element, isOpen, settingsKey, boundaryReady]);
  React.useLayoutEffect(() => () => { if (element) cancelTooltipAnimations(element); }, [element]);
  React.useEffect(() => {
    if (!element || !trigger || !isOpen || resolved.motion !== 'swing' || resolved.reducedMotion) return;
    const wrapper = element.parentElement!;
    const controller = createTooltipSwingController(wrapper, resolved);
    const move = (event: PointerEvent) => { if (event.pointerType !== 'touch') controller.track(trigger, event.clientX); };
    trigger.addEventListener('pointermove', move);
    return () => { trigger.removeEventListener('pointermove', move); controller.stop(); controller.reset(); };
  }, [element, trigger, isOpen, settingsKey]);
  React.useEffect(() => {
    if (!isOpen || !trigger) return;
    const view = trigger.ownerDocument.defaultView!;
    view.addEventListener('resize', dismiss);
    return () => view.removeEventListener('resize', dismiss);
  }, [isOpen, trigger, dismiss]);
  if (!present && !isOpen) return null;
  // Never let Radix clone visual refs into its hidden semantic description.
  return <RadixTooltip.Content forceMount ref={positioningRef} aria-label={ariaLabel ?? accessibleText} dir={dir}
    side={collisionBoundary && avoidCollisions !== false ? admittedSide : side}
    sideOffset={sideOffset ?? (resolved.arrow ? resolved.geometry.gap : resolved.geometry.gapWithoutArrow)}
    align={align} alignOffset={alignOffset} avoidCollisions={avoidCollisions} collisionBoundary={collisionBoundary}
    collisionPadding={collisionPadding ?? resolved.geometry.viewportPadding} arrowPadding={arrowPadding}
    sticky={sticky} hideWhenDetached={hideWhenDetached} updatePositionStrategy={updatePositionStrategy}
    style={{ ...inheritedTheme, ...owner?.themeStyle, zIndex: layer, pointerEvents: isOpen ? undefined : 'none',
      width: 'max-content', maxWidth: 'var(--radix-tooltip-content-available-width, calc(100vw - 16px))' }}
    onEscapeKeyDown={event => { onEscapeKeyDown?.(event); if (!event.defaultPrevented) dismiss(); }}
    onPointerDownOutside={onPointerDownOutside} inert={!isOpen || (owner && !owner.active) || undefined}>
    <motion.div data-slot="popover-content" data-zero-tooltip="" ref={visualRef}
      data-side={typeof resolvedSide === 'string' ? resolvedSide : side}
      data-align={typeof resolvedAlign === 'string' ? resolvedAlign : align ?? 'center'}
      data-state={isOpen ? 'open' : 'closed'} data-motion={resolved.motion} data-variant={resolved.variant} data-arrow={resolved.arrow}
      dir={dir} {...props} style={{
        ...(followCursor === true || followCursor === 'x' ? { x: resolved.reducedMotion ? 0 : translateX } : {}),
        ...(followCursor === true || followCursor === 'y' ? { y: resolved.reducedMotion ? 0 : translateY } : {}),
        position: 'relative', ...inheritedTheme, ...owner?.themeStyle, ...style, zIndex: layer,
        ...(!boundaryReady ? { visibility: 'hidden' } : {}),
      }} data-zero-overlay-owner={owner?.id} />
  </RadixTooltip.Content>;
}

type TooltipArrowProps = React.ComponentProps<typeof RadixTooltip.Arrow>;
/** Resolved arrow positioning remains Radix's responsibility, including edge shifts. */
function TooltipArrow(props: TooltipArrowProps) { return <RadixTooltip.Arrow data-slot="tooltip-arrow" {...props} />; }

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipPortal, TooltipContent, TooltipArrow, useTooltip, useTooltipProviderSettings,
  type TooltipProviderProps, type TooltipProps, type TooltipTriggerProps, type TooltipPortalProps,
  type TooltipContentProps, type TooltipArrowProps, type TooltipContextType };
