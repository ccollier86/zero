'use client';

/**
 * Adapts React-controlled content to the manager without descriptor replacement on
 * each keystroke. Each opening owns a bridge; structural/target changes retire it.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { modals } from './modal-events';
import { ModalManager } from './modal-manager';
import { useModalHostPresent } from './modal-host-context';
import type { ModalAction, ModalBody, ModalContext, ModalDescriptor, ModalHandle, ModalPresentationUpdate, ModalResult } from './modal-system.types';
import { emitFrontendCode } from '../frontend/client/observability';
import { OBS_CODES } from '../observability/codes';
import { bindModalFormState } from './modal-form';
import { useOverlayScope } from '../components/overlays/overlay-scope';
import { modalStore } from './modal-store';

/** Geometry/section structure are snapshotted per opening; presentation/body/actions stay live inside the same ownership key. */
export interface ControlledModalProps<T = unknown> {
  readonly open: boolean;
  readonly descriptor: ModalDescriptor<T>;
  /** Changing the target/frame retires the prior dialog, its callbacks and pending admission. */
  readonly identityKey?: string | number;
  readonly onOpenChange: (open: boolean) => void;
  readonly onResult?: (result: Exclude<ModalResult<T>, { readonly kind: 'retired' }>) => void;
  /** Optional existing domain-controller projection; other form contributions remain owned separately. */
  readonly busy?: boolean;
  readonly dirty?: boolean;
  /** Caller-supplied safe user-facing error, never arbitrary caught exception text. */
  readonly error?: string | null;
  readonly children?: ReactNode;
}

class BodyBridge<T> {
  private live: ControlledModalProps<T>;
  private readonly listeners = new Set<() => void>();
  private readonly actionCallbacks = new Map<string, NonNullable<ModalAction<T>['onClick']>>();
  private readonly headerCallbacks = new Map<string, (context: ModalContext<T>) => void | Promise<void>>();
  private projected: ModalPresentationUpdate<T> | null = null;
  constructor(props: ControlledModalProps<T>) { this.live = props; }
  readonly read = () => this.live;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  publish(props: ControlledModalProps<T>): void {
    if (this.live === props) return;
    this.live = props; for (const listener of this.listeners) listener();
  }
  /** Stable callback identities keep ordinary scope-provider renders from republishing the store. */
  presentation(): ModalPresentationUpdate<T> {
    const d = this.live.descriptor;
    const next: ModalPresentationUpdate<T> = { title: d.title, meta: d.meta, description: d.description, icon: d.icon,
      tone: d.tone, footer: d.footer,
      actions: d.actions?.map(action => {
        let onClick = this.actionCallbacks.get(action.id);
        if (action.onClick && !onClick) {
          const id = action.id;
          onClick = context => {
            const current = this.live.descriptor.actions?.find(candidate => candidate.id === id);
            return current?.onClick ? current.onClick(context) : false;
          };
          this.actionCallbacks.set(id, onClick);
        }
        return { ...action, onClick: action.onClick ? onClick : undefined };
      }),
      headerActions: d.headerActions?.map(action => {
        let onClick = this.headerCallbacks.get(action.id);
        if (!onClick) { const id = action.id; onClick = context => this.live.descriptor.headerActions?.find(current => current.id === id)?.onClick(context);
          this.headerCallbacks.set(id, onClick); }
        return { ...action, onClick };
      }),
    };
    if (this.projected && equalPresentation(this.projected, next)) return this.projected;
    this.projected = next; return next;
  }
}

function equalPresentation<T>(left: ModalPresentationUpdate<T>, right: ModalPresentationUpdate<T>): boolean {
  const sameRows = (a: readonly object[] | undefined, b: readonly object[] | undefined) => a?.length === b?.length
    && (a ?? []).every((entry, index) => {
      const other = b![index]!;
      const keys = new Set([...Object.keys(entry), ...Object.keys(other)]);
      return [...keys].every(key => Object.is((entry as Record<string, unknown>)[key], (other as Record<string, unknown>)[key]));
    });
  return Object.is(left.title, right.title) && Object.is(left.meta, right.meta) && Object.is(left.description, right.description)
    && Object.is(left.icon, right.icon) && Object.is(left.tone, right.tone) && Object.is(left.footer?.start, right.footer?.start)
    && sameRows(left.actions, right.actions) && sameRows(left.headerActions, right.headerActions);
}

function readBody<T>(body: ModalBody<T> | undefined, context: ModalContext<T>): ReactNode {
  return typeof body === 'function' ? body(context) : body;
}
function BridgedBody<T>({ bridge, context, sectionId }: { bridge: BodyBridge<T>; context: ModalContext<T>; sectionId?: string }) {
  const { descriptor } = useSyncExternalStore(bridge.subscribe, bridge.read, bridge.read);
  if (sectionId !== undefined) return descriptor.layout === 'tabs' || descriptor.layout === 'nav'
    ? readBody(descriptor.sections.find(section => section.id === sectionId)?.body, context) : null;
  return descriptor.layout !== 'tabs' && descriptor.layout !== 'nav' ? readBody(descriptor.body, context) : null;
}

/** A stable descriptor uses a per-opening React bridge rather than updateDescriptor's retirement path. */
function bridgedDescriptor<T>(bridge: BodyBridge<T>): ModalDescriptor<T> {
  const initial = bridge.read().descriptor;
  const common = { ...initial, ...bridge.presentation(),
    beforeClose: initial.beforeClose ? (close: Parameters<NonNullable<typeof initial.beforeClose>>[0]) => {
      const current = bridge.read().descriptor.beforeClose;
      return current ? current(close) : true;
    } : undefined,
    onClose: () => { bridge.read().descriptor.onClose?.(); },
  };
  if (initial.layout === 'tabs' || initial.layout === 'nav') return { ...common, layout: initial.layout,
    sections: initial.sections.map(section => ({ ...section,
      body: (context: ModalContext<T>) => <BridgedBody bridge={bridge} context={context} sectionId={section.id} /> })),
  } as ModalDescriptor<T>;
  return { ...common, layout: 'content',
    body: (context: ModalContext<T>) => <BridgedBody bridge={bridge} context={context} />,
  } as ModalDescriptor<T>;
}

function reportNotificationFailure(): void {
  emitFrontendCode(OBS_CODES.FRONTEND_MODAL_CALLBACK_FAILED, { metadata: { surface: 'controlled-modal', stage: 'notification' } });
}

/** Notification failure, including a rejected async observer, cannot reopen an acknowledged action. */
function notifyControlledObserver(callback: () => unknown, stillOwned: () => boolean): void {
  if (!stillOwned()) return;
  const failed = () => { if (stillOwned()) reportNotificationFailure(); };
  try { void Promise.resolve(callback()).catch(failed); }
  catch { failed(); }
}

/**
 * User X/Escape/backdrop/cancel still use manager admission. Setting open=false,
 * changing identityKey, or unmounting is owner-driven retirement, not a leave request.
 */
export function ControlledModal<T = unknown>(props: ControlledModalProps<T>) {
  const inheritedHost = useModalHostPresent();
  const owner = useOverlayScope(), parentId = props.descriptor.parentId ?? owner?.id;
  const active = useRef<{ readonly identityKey: ControlledModalProps<T>['identityKey']; readonly bridge: BodyBridge<T>;
    readonly handle: ModalHandle<T>; readonly parentId?: string; presentation: ModalPresentationUpdate<T>;
    readonly disabled: Map<string, boolean>; binding?: ReturnType<typeof bindModalFormState> } | null>(null);
  // A settled opening cannot replay merely because a notification failed or a
  // controlled owner has not yet reflected open=false. Only a deliberate new
  // open cycle or target identity admits another writer.
  const closed = useRef<{ readonly identityKey: ControlledModalProps<T>['identityKey']; readonly parentId?: string } | null>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    if (!props.open || (closed.current && (!Object.is(closed.current.identityKey, props.identityKey) || closed.current.parentId !== parentId))) {
      closed.current = null;
    }
    const previous = active.current;
    if (previous && (!props.open || !Object.is(previous.identityKey, props.identityKey) || previous.parentId !== parentId)) {
      active.current = null; previous.binding?.dispose(); modals.disposeHost([previous.handle.id]);
    }
    if (!props.open) return;
    if (closed.current) return;
    if (active.current) {
      active.current.bridge.publish(props);
      const context = modals.getContext(active.current.handle.id);
      const presentation = active.current.bridge.presentation();
      if (context && active.current.presentation !== presentation) {
        modals.projectPresentation(active.current.handle.id, context.signal, presentation);
        active.current.presentation = presentation;
      }
      for (const action of props.descriptor.actions ?? []) {
        const previousDisabled = active.current.disabled.get(action.id);
        if (action.disabled !== undefined && previousDisabled !== action.disabled) context?.setActionDisabled(action.id, action.disabled);
        else if (action.disabled === undefined && previousDisabled !== undefined) context?.setActionDisabled(action.id, false);
        if (action.disabled !== undefined) active.current.disabled.set(action.id, action.disabled);
        else active.current.disabled.delete(action.id);
      }
      projectState(active.current, props);
      return;
    }
    if (parentId) {
      const snapshot = modalStore.getSnapshot().context;
      if (!snapshot.modals.some(modal => modal.id === parentId) || snapshot.closingIds.includes(parentId)) return;
    }
    const bridge = new BodyBridge(props), handle = modals.show({ ...bridgedDescriptor(bridge), parentId });
    const opening = { bridge, handle, identityKey: props.identityKey, parentId, presentation: bridge.presentation(),
      disabled: new Map((props.descriptor.actions ?? []).filter(action => action.disabled !== undefined).map(action => [action.id, action.disabled!])),
      binding: undefined as ReturnType<typeof bindModalFormState> | undefined };
    active.current = opening;
    projectState(opening, props);
    void handle.result.then(result => {
      if (!mounted.current || active.current !== opening) return;
      active.current = null;
      opening.binding?.dispose();
      if (result.kind === 'retired') return;
      closed.current = { identityKey: opening.identityKey, parentId: opening.parentId };
      const notificationOwner = closed.current;
      const stillOwned = () => mounted.current && closed.current === notificationOwner;
      const current = bridge.read();
      notifyControlledObserver(() => current.onResult?.(result), stillOwned);
      notifyControlledObserver(() => current.onOpenChange(false), stillOwned);
    });
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const previous = active.current; active.current = null;
      if (previous) { previous.binding?.dispose(); modals.disposeHost([previous.handle.id]); }
    };
  }, []);
  return inheritedHost ? props.children ?? null : <ModalManager>{props.children ?? null}</ModalManager>;
}

function projectState<T>(opening: { readonly handle: ModalHandle<T>; binding?: ReturnType<typeof bindModalFormState> }, props: ControlledModalProps<T>) {
  const supplied = props.busy !== undefined || props.dirty !== undefined || props.error !== undefined;
  if (!supplied) { opening.binding?.dispose(); opening.binding = undefined; return; }
  const context = modals.getContext(opening.handle.id);
  if (!context) return;
  opening.binding ??= bindModalFormState(context);
  opening.binding.update({ busy: props.busy === true, dirty: props.dirty === true, error: props.error ?? null });
}
