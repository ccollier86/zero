'use client';

/** Hosts exact-owned modal shells and one coordinated scene; Radix retains focus/dismissal ownership. */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { OverlayScopeProvider, hasOwnedFloatingOverlay, useOverlayTheme } from '../components/overlays/overlay-scope';
import { useMediaQuery } from '../hooks/use-media-query';
import { modalStore } from './modal-store';
import { modals } from './modal-events';
import { ModalScrollShell as ModalShell } from './modal-scroll-shell';
import { resolveModalMotion } from './modal-motion';
import { animateModalIn, animateModalOut, animateModalNudge, cancelModalAnimations, finishModalAnimations, playModalAnimation } from './modal-motion-animation';
import { createModalSceneMotion, modalStackTransform } from './modal-scene-motion';
import type { ModalMotionOptions, ResolvedModalMotion, ModalMotionEntrance } from './modal-motion-types';
import type { ModalInstance, ModalStoreState } from './modal.types';
import { cn } from '../lib/utils';
import { emitFrontendCode } from '../frontend/client/observability';
import { OBS_CODES } from '../observability/codes';
import { ModalHostContext, useModalHostLease, hasModalHosts } from './modal-host-context';
import { ModalExitSnapshot, type ModalExitPaint } from './modal-exit-snapshot';

const EMPTY: ModalStoreState = { modals: [], closingIds: [] };

function useModalViewport(): React.CSSProperties {
  const read = () => {
    const viewport = typeof window === 'undefined' ? null : window.visualViewport;
    return viewport ? { top: viewport.offsetTop, left: viewport.offsetLeft, width: viewport.width,
      height: viewport.height, right: 'auto', bottom: 'auto' } : {};
  };
  const [viewport, setViewport] = React.useState<React.CSSProperties>(read);
  React.useEffect(() => {
    const target = window.visualViewport;
    if (!target) return;
    const refresh = () => setViewport(read());
    target.addEventListener('resize', refresh); target.addEventListener('scroll', refresh); refresh();
    return () => { target.removeEventListener('resize', refresh); target.removeEventListener('scroll', refresh); };
  }, []);
  return viewport;
}

function useModalStore() {
  return React.useSyncExternalStore(callback => {
    const subscription = modalStore.subscribe(callback);
    return () => subscription.unsubscribe();
  }, () => modalStore.getSnapshot().context, () => EMPTY);
}

function reduceProfile(profile: ResolvedModalMotion, reduced: boolean): ResolvedModalMotion {
  return reduced ? { ...profile, reducedMotion: true,
    timings: Object.fromEntries(Object.keys(profile.timings).map(key => [key, 1])) as unknown as ResolvedModalMotion['timings'] } : profile;
}

function ModalRenderer({ modal, depth, active, closing, layer, defaults, portalContainer, onMotion, onBackdropTheme, onReturnFocus }: {
  modal: ModalInstance; depth: number; active: boolean; closing: boolean; layer: number; defaults?: ModalMotionOptions;
  portalContainer?: HTMLElement | null;
  onMotion(id: string, motion: ResolvedModalMotion): void;
  onBackdropTheme(id: string, theme: React.CSSProperties): void;
  onReturnFocus(restore: () => void): void;
}) {
  const shell = React.useRef<HTMLDivElement>(null), inner = React.useRef<HTMLDivElement>(null);
  const viewport = useModalViewport();
  const exitPaint = React.useRef<ModalExitPaint | null>(null), retainedDepth = React.useRef(depth);
  if (!closing) retainedDepth.current = depth;
  const [shellElement, setShellElement] = React.useState<HTMLDivElement | null>(null);
  const mountShell = React.useCallback((element: HTMLDivElement | null) => {
    shell.current = element; setShellElement(element);
  }, []);
  const mountPaint = React.useCallback((host: HTMLDivElement | null) => {
    const paint = exitPaint.current;
    if (!host || !paint) return;
    host.replaceChildren(paint.element);
    shell.current = paint.element;
    inner.current = paint.element.querySelector<HTMLDivElement>('[data-zero-modal-inner]');
    const freeze = (element: HTMLElement, visual: ModalExitPaint['visual']) => playModalAnimation(element,
      [{ ...visual }, { ...visual }], { duration: 1, fill: 'forwards' });
    freeze(paint.element, paint.visual);
    if (inner.current && paint.innerVisual) freeze(inner.current, paint.innerVisual);
    setShellElement(paint.element);
  }, []);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)', { initializeWithValue: true });
  const profile = React.useRef<ResolvedModalMotion | null>(null), entrance = React.useRef<ModalMotionEntrance>('rise');
  const admittedDefaults = React.useRef({ ...defaults }).current;
  const options = { ...admittedDefaults, ...modal.descriptor?.motion }, signature = JSON.stringify(options);
  const admittedSignature = React.useRef<string | null>(null);
  const [resolved, setResolved] = React.useState(() => resolveModalMotion(null, options, false));
  const opener = React.useRef(typeof document === 'undefined' ? null
    : modal.descriptor?.trigger instanceof HTMLElement ? modal.descriptor.trigger : document.activeElement as HTMLElement | null);
  const theme = useOverlayTheme(modal.descriptor?.trigger ?? opener.current);
  const motion = React.useMemo(() => reduceProfile(resolved, reduced), [resolved, reduced]);
  const descriptor = modal.descriptor, context = modals.getContext(modal.id);
  const live = React.useRef({ active, closing }); live.current = { active, closing };
  const generation = modal.generation;
  React.useLayoutEffect(() => {
    if (!shell.current || profile.current && admittedSignature.current === signature) return;
    const first = !profile.current;
    admittedSignature.current = signature;
    profile.current = resolveModalMotion(shell.current, options, false);
    setResolved(profile.current);
    if (!closing && (first || shell.current.getAnimations().some(animation => animation.playState === 'running'))) {
      const playback = animateModalIn(shell.current, inner.current, descriptor?.trigger ?? null,
        reduceProfile(profile.current, reduced));
      entrance.current = playback.entrance;
    }
  }, [shellElement, signature]);
  React.useEffect(() => {
    if (!shellElement) return;
    const content = inner.current;
    return () => { cancelModalAnimations(shellElement); if (content) cancelModalAnimations(content); };
  }, [shellElement]);
  React.useLayoutEffect(() => { onMotion(modal.id, motion); }, [modal.id, motion, onMotion]);
  // Reuse this renderer's exact trigger/programmatic opener subscription. The
  // host projects paint only; it must not infer a different theme source.
  React.useLayoutEffect(() => { onBackdropTheme(modal.id, theme); }, [modal.id, theme, onBackdropTheme]);
  React.useLayoutEffect(() => {
    if (!closing) return;
    if (!shell.current) { modals.completeExit(modal.id, generation); return; }
    const playback = animateModalOut(shell.current, inner.current, descriptor?.trigger ?? null, motion, entrance.current);
    let current = true;
    void playback.finished.then(() => { if (current) modals.completeExit(modal.id, generation); });
    return () => { current = false; };
  }, [closing, shellElement, modal.id, generation, motion, descriptor?.trigger]);
  React.useLayoutEffect(() => {
    if (!reduced || !shell.current) return;
    for (const element of [shell.current, inner.current]) if (element) finishModalAnimations(element);
  }, [reduced]);
  const initialFocus = (event: Event) => {
    event.preventDefault();
    if (!live.current.active || live.current.closing || !shell.current) return;
    const preference = descriptor?.initialFocus ?? (descriptor?.tone === 'danger' ? 'cancel' : 'auto');
    let target: HTMLElement | null = null;
    if (preference === 'cancel') target = shell.current.querySelector('[data-modal-action-role="cancel"]');
    else if (preference === 'primary') {
      const primary = shell.current.querySelector<HTMLElement>('[data-modal-action-primary]');
      target = primary?.matches('button') ? primary : primary?.querySelector('button:not([disabled])') ?? null;
    }
    else if (preference !== 'auto') { try { target = shell.current.querySelector(preference); } catch { /* Fall back to the named dialog. */ } }
    else if (!window.matchMedia('(pointer: coarse)').matches) target = shell.current.querySelector('input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled])');
    (target ?? shell.current).focus({ preventScroll: true });
  };
  const closeFocus = (event: Event) => {
    if (!live.current.closing) { event.preventDefault(); return; } // Retirement suppresses old-scope focus callbacks.
    event.preventDefault();
    const snapshot = modalStore.getSnapshot().context;
    const top = snapshot.modals.filter(item => item.id !== modal.id && !snapshot.closingIds.includes(item.id)).at(-1);
    if (top && modal.parentId !== top.id) return;
    const target = opener.current;
    const restore = () => {
      // A fresh cancelable event keeps caller vetoes distinct from the manager's Radix veto.
      const intent = new Event('zero-modal-close-auto-focus', { cancelable: true });
      try {
        const notification = descriptor?.onCloseAutoFocus?.(intent);
        void Promise.resolve(notification).catch(() => emitFrontendCode(OBS_CODES.FRONTEND_MODAL_CALLBACK_FAILED,
          { metadata: { surface: 'modal', stage: 'return-focus' } }));
      }
      catch { emitFrontendCode(OBS_CODES.FRONTEND_MODAL_CALLBACK_FAILED, { metadata: { surface: 'modal', stage: 'return-focus' } }); }
      if (!intent.defaultPrevented && target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
    };
    if (!top) onReturnFocus(restore); else restore();
  };
  const outside = (event: { preventDefault(): void; target?: EventTarget | null }) => {
    if (!active || closing || descriptor?.dismissible === false || descriptor?.closeOnClickOutside === false
      || modal.closeOnClickOutside === false || modal.systemState?.busy || hasOwnedFloatingOverlay(modal.id)) event.preventDefault();
    if (event.target instanceof Element && event.target.closest('[data-zero-overlay-owner]')?.getAttribute('data-zero-overlay-owner') === modal.id) event.preventDefault();
  };
  const size = descriptor?.size ?? modal.size ?? 'md', custom = descriptor?.customSize ?? modal.customSize;
  const style = { ...theme, '--zero-modal-width': custom?.width ?? (size === 'full' ? '100%' : `var(--zero-modal-width-${size})`),
    ...(custom?.maxWidth ? { maxWidth: `min(${custom.maxWidth},100%)` } : {}),
    ...(custom?.height ? { height: `min(${custom.height},100%)` } : {}),
    ...(custom?.maxHeight ? { maxHeight: `min(${custom.maxHeight},100%)` } : {}),
  } as React.CSSProperties;
  return <OverlayScopeProvider value={{ id: modal.id, zIndex: layer, active, themeStyle: theme, container: portalContainer }}>
    <ModalExitSnapshot closing={closing} element={shell} onCapture={paint => { exitPaint.current = paint; }}>
    <Dialog.Root open={!closing} modal onOpenChange={open => {
      if (!open && active) void modals.requestClose(modal.id, { reason: 'backdrop' });
    }}><Dialog.Portal forceMount container={portalContainer}>
      <div className="zero-modal-layer" data-placement={descriptor?.placement ?? 'center'} data-size={size}
        inert={!active || closing || undefined} aria-hidden={!active || closing || undefined}
        style={{ ...viewport, zIndex: layer, transform: modalStackTransform(retainedDepth.current, motion), transition: `transform ${motion.timings.stack}ms ${motion.easing.out}`,
          ...(closing ? { pointerEvents: 'none' } : {}) }}>
        {closing ? <div ref={mountPaint} className="zero-modal__exit-paint" aria-hidden="true" inert /> : <Dialog.Content forceMount ref={mountShell} role={descriptor?.role ?? (modal.type === 'confirm' ? 'alertdialog' : 'dialog')}
          {...(descriptor?.description == null ? { 'aria-describedby': undefined } : {})}
          className={cn('zero-modal', !descriptor && 'zero-modal__legacy', descriptor?.className ?? modal.className)}
          data-zero-modal-id={modal.id} data-size={size}
          data-slot={descriptor?.dataSlot}
          data-height={descriptor?.height ?? (descriptor?.layout === 'tabs' || descriptor?.layout === 'nav' ? 'fixed' : 'auto')}
          style={style} onOpenAutoFocus={initialFocus} onCloseAutoFocus={closeFocus}
          onEscapeKeyDown={event => {
            // Child retirement must not turn its handled Escape into a parent dismissal.
            if (event.defaultPrevented) return;
            if (active && !closing && !modal.systemState?.busy && descriptor?.dismissible === false && shell.current) animateModalNudge(shell.current, motion);
            if (!active || closing || modal.closeOnEscape === false || descriptor?.closeOnEscape === false
              || descriptor?.dismissible === false || modal.systemState?.busy || hasOwnedFloatingOverlay(modal.id)) { event.preventDefault(); return; }
            event.preventDefault(); void modals.requestClose(modal.id, { reason: 'escape' });
          }} onPointerDownOutside={event => {
            outside(event);
            if (active && !closing && !modal.systemState?.busy && descriptor?.dismissible === false && shell.current) animateModalNudge(shell.current, motion);
          }} onInteractOutside={outside}>
          {descriptor && context && modal.systemState ? <ModalShell descriptor={descriptor} context={context}
            state={modal.systemState} motion={motion} innerRef={inner} /> : <>
            <Dialog.Title className="sr-only">{modal.title ?? 'Dialog'}</Dialog.Title>
            <div className="zero-modal__legacy-controls">{modal.showCloseButton !== false && <Button type="button" variant="ghost"
              aria-label="Close" className="zero-modal__close" onClick={() => { void modals.requestClose(modal.id, { reason: 'close-button' }); }}><X aria-hidden="true" /></Button>}</div>
            <div ref={inner} data-zero-modal-inner>{modal.content}</div>
          </>}
        </Dialog.Content>}
      </div>
    </Dialog.Portal></Dialog.Root>
    </ModalExitSnapshot>
  </OverlayScopeProvider>;
}

export interface ModalManagerProps {
  children?: React.ReactNode;
  /** Provider presentation defaults; per-call motion options override these. */
  motion?: ModalMotionOptions;
  /** Wrap an app-only recession surface; portals remain outside it. Default true. */
  recedeSurface?: boolean;
  /** Same-document, app-owned non-transformed portal root outside the recession surface. Default document.body. */
  portalContainer?: HTMLElement | null;
}

function ModalHost({ children, motion: defaults, recedeSurface = true, portalContainer }: ModalManagerProps) {
  const state = useModalStore(), surface = React.useRef<HTMLDivElement>(null), backdrop = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false), [reserved, setReserved] = React.useState(false);
  const [layerBase, setLayerBase] = React.useState(1000);
  const profiles = React.useRef(new Map<string, ResolvedModalMotion>());
  const backdropThemes = React.useRef(new Map<string, string>());
  const controller = React.useRef<ReturnType<typeof createModalSceneMotion> | null>(null);
  const lease = React.useRef<object | null>(null), sceneEpoch = React.useRef(0), returnFocus = React.useRef<(() => void) | null>(null);
  const ids = React.useRef<string[]>([]); ids.current = state.modals.map(modal => modal.id);
  const ownsHost = useModalHostLease(() => {
    modals.disposeHost([...ids.current]);
    controller.current?.dispose(); controller.current = null;
  });
  const [profileVersion, setProfileVersion] = React.useState(0);
  const onMotion = React.useCallback((id: string, profile: ResolvedModalMotion) => {
    if (profiles.current.get(id) === profile) return;
    profiles.current.set(id, profile); setProfileVersion(value => value + 1);
  }, []);
  const [themeVersion, setThemeVersion] = React.useState(0);
  const [retainedBackdrop, setRetainedBackdrop] = React.useState('');
  const onBackdropTheme = React.useCallback((id: string, theme: React.CSSProperties) => {
    const color = String((theme as Record<string, unknown>)['--zero-modal-backdrop-color'] ?? '').trim();
    if (backdropThemes.current.get(id) === color) return;
    backdropThemes.current.set(id, color); setThemeVersion(value => value + 1);
  }, []);
  const [focusVersion, setFocusVersion] = React.useState(0);
  const onReturnFocus = React.useCallback((restore: () => void) => {
    returnFocus.current = restore; setFocusVersion(value => value + 1);
  }, []);
  const activeModals = state.modals.filter(modal => !state.closingIds.includes(modal.id));
  const top = activeModals.at(-1), visible = activeModals.length > 0, present = state.modals.length > 0;
  const activeBackdrop = top ? backdropThemes.current.get(top.id) : undefined;
  const backdropColor = activeBackdrop ?? retainedBackdrop;
  React.useLayoutEffect(() => {
    // Retirement may remove the last shell before the shared scene fade ends.
    // Keep its admitted paint until the existing scene epoch releases the lease.
    if (activeBackdrop !== undefined) setRetainedBackdrop(activeBackdrop);
  }, [top?.id, themeVersion, activeBackdrop]);
  React.useLayoutEffect(() => {
    if (!mounted) return;
    const source = top?.descriptor?.trigger ?? surface.current ?? portalContainer ?? document.documentElement;
    const configured = Number(getComputedStyle(source).getPropertyValue('--zero-modal-layer-base').trim());
    setLayerBase(Number.isFinite(configured) && configured > 0 ? Math.min(2_000_000_000, Math.trunc(configured)) : 1000);
  }, [mounted, top?.id, portalContainer]);
  React.useEffect(() => {
    setMounted(true); lease.current = {};
    return () => {
      lease.current = null; const owned = [...ids.current];
      queueMicrotask(() => { if (lease.current === null) {
        if (!hasModalHosts()) modals.disposeHost(owned);
        controller.current?.dispose();
      } });
    };
  }, []);
  React.useLayoutEffect(() => {
    if (!ownsHost || !mounted || !backdrop.current) return;
    controller.current ??= createModalSceneMotion(backdrop.current, recedeSurface ? surface.current : null);
    const profile = top ? profiles.current.get(top.id) ?? resolveModalMotion(surface.current, defaults)
      : [...profiles.current.values()].at(-1) ?? resolveModalMotion(surface.current, defaults);
    const epoch = ++sceneEpoch.current;
    if (visible) setReserved(true);
    void controller.current.update({ visible, recedes: activeModals.some(modal =>
      (profiles.current.get(modal.id) ?? profile).pageRecedes), motion: profile }).then(() => {
      if (epoch === sceneEpoch.current && !visible) {
        setReserved(false); profiles.current.clear(); backdropThemes.current.clear(); setRetainedBackdrop('');
      }
    });
  }, [ownsHost, mounted, visible, top?.id, state.closingIds.join(','), profileVersion, defaults, recedeSurface]);
  React.useLayoutEffect(() => {
    if (!ownsHost || !present && !reserved) return;
    const element = document.body, overflow = element.style.overflow, padding = element.style.paddingRight;
    const gap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    element.style.overflow = 'hidden';
    if (gap) element.style.paddingRight = `${(parseFloat(getComputedStyle(element).paddingRight) || 0) + gap}px`;
    return () => { element.style.overflow = overflow; element.style.paddingRight = padding; };
  }, [ownsHost, present || reserved]);
  React.useLayoutEffect(() => {
    if (present || reserved || !returnFocus.current) return;
    const restore = returnFocus.current, epoch = sceneEpoch.current; returnFocus.current = null;
    const frame = requestAnimationFrame(() => {
      if (epoch === sceneEpoch.current && !modalStore.getSnapshot().context.modals.length) restore();
    });
    return () => cancelAnimationFrame(frame);
  }, [present, reserved, focusVersion]);
  const scene = mounted && ownsHost && <>
    <div ref={backdrop} className="zero-modal-backdrop" hidden={!visible && !reserved} aria-hidden="true"
      style={{ ...(backdropColor ? { '--zero-modal-backdrop-color': backdropColor } : {}),
        zIndex: top ? layerBase + state.modals.findIndex(item => item.id === top.id) * 10 : layerBase } as React.CSSProperties} />
    {state.modals.map((modal, index) => <ModalRenderer key={modal.id} modal={modal} layer={layerBase + 1 + index * 10}
      depth={Math.max(0, activeModals.length - 1 - activeModals.findIndex(item => item.id === modal.id))}
      active={top?.id === modal.id} closing={state.closingIds.includes(modal.id)} defaults={defaults}
      portalContainer={portalContainer} onMotion={onMotion} onBackdropTheme={onBackdropTheme} onReturnFocus={onReturnFocus} />)}
  </>;
  return <ModalHostContext.Provider value={true}>
    {recedeSurface ? <div ref={surface} data-zero-modal-surface inert={present || reserved || undefined}>{children}</div> : children}
    {mounted && createPortal(scene, portalContainer ?? document.body)}
  </ModalHostContext.Provider>;
}

/** Mount once; nested managers inherit their host rather than rendering duplicate global dialogs. */
export function ModalManager(props: ModalManagerProps) {
  if (typeof document !== 'undefined' && props.portalContainer && props.portalContainer.ownerDocument !== document) {
    throw new TypeError('ModalManager portalContainer must belong to the current document.');
  }
  return React.useContext(ModalHostContext) ? <>{props.children}</> : <ModalHost {...props} />;
}
