/**
 * Modal facade and lifecycle kernel. Owns exact-ID admission, parent/child cleanup,
 * acknowledged UI action settlement and stale-generation fencing. Rendering,
 * transport, server idempotency, form validation and authorization remain outside.
 */
import type { ReactNode } from 'react';
import { modalStore } from './modal-store';
import { notifyModalClosed } from './modal-close-callback';
import { ModalCloseAdmission } from './modal-close-admission';
import { validateModalMotionOptions } from './modal-motion';
import { createModalPromptDescriptor, type ModalPromptOptions } from './modal-prompt';
import { emitFrontendCode } from '../frontend/client/observability';
import { OBS_CODES } from '../observability/codes';
import type { OpenModalOptions, OpenConfirmOptions, ModalInstance, ModalCloseOptions } from './modal.types';
import type {
  ModalActionConfirmOptions, ModalBeforeCloseGuard, ModalCloseReason, ModalContext, ModalDecisionOptions,
  ModalDescriptor, ModalHandle, ModalPresentationUpdate, ModalResult, ModalSystemState,
} from './modal-system.types';

interface OwnedSession {
  readonly generation: number;
  readonly lifetime: AbortController;
  readonly context: ModalContext<unknown>;
  readonly beforeCloseGuards: Map<symbol, ModalBeforeCloseGuard>;
  actionPending: boolean;
}

const sessions = new Map<string, OwnedSession>();
let counter = 0;
let retiring = 0;
const state = () => modalStore.getSnapshot().context;
const find = (id: string) => state().modals.find(modal => modal.id === id);
const isOpen = (id: string) => !!find(id) && !state().closingIds.includes(id);
const nextId = () => `modal-${++counter}-${Date.now().toString(36)}`;

const closeAdmission = new ModalCloseAdmission({
  isCurrent: modal => {
    const current = find(modal.id);
    return !state().closingIds.includes(modal.id) && (modal.descriptor
      ? current?.generation === modal.generation && !!current?.descriptor
      : current === modal);
  },
  commit: (modal, reason) => dismissCommitted(modal.id, reason),
  onFailure: () => reportFailure('before-close'),
});

function reportFailure(stage: 'before-close' | 'action' | 'header-action'): void {
  emitFrontendCode(OBS_CODES.FRONTEND_MODAL_CALLBACK_FAILED, {
    metadata: { surface: 'modal-manager', stage },
  });
}

function currentSession(id: string, session: OwnedSession): boolean {
  return sessions.get(id) === session && !session.lifetime.signal.aborted
    && find(id)?.generation === session.generation && isOpen(id);
}

function patchState(id: string, session: OwnedSession, updates: Partial<ModalSystemState>): void {
  if (!currentSession(id, session)) return;
  const modal = find(id)!;
  modalStore.send({ type: 'update', id, updates: { systemState: { ...modal.systemState!, ...updates } } });
}

function makeSession(id: string, generation: number): OwnedSession {
  const lifetime = new AbortController();
  const session: OwnedSession = {
    generation, lifetime, actionPending: false, beforeCloseGuards: new Map(),
    context: {
      id, signal: lifetime.signal,
      accept: value => currentSession(id, session) && accept(id, value),
      requestClose: reason => currentSession(id, session)
        ? requestClose(id, { reason }) : Promise.resolve(false),
      setError: error => patchState(id, session, { error }),
      setBusy: busy => patchState(id, session, { busy: session.actionPending || busy }),
      setDirty: dirty => patchState(id, session, { dirty }),
      setActionDisabled: (actionId, disabled) => {
        const current = find(id);
        if (!currentSession(id, session) || !current?.descriptor?.actions?.some(action => action.id === actionId)) return;
        patchState(id, session, { disabledActions: { ...current.systemState!.disabledActions, [actionId]: disabled } });
      },
      show: <T>(descriptor: ModalDescriptor<T>) => {
        if (!currentSession(id, session)) return retiredHandle<T>();
        return show({ ...descriptor, parentId: id });
      },
    },
  };
  return session;
}

function retiredHandle<T>(): ModalHandle<T> {
  return { id: '', result: Promise.resolve({ kind: 'retired' }), close: () => false,
    dismiss: () => Promise.resolve(false), update: () => {} };
}

function descendants(id: string): ModalInstance[] {
  const all = state().modals;
  const owned = new Set([id]);
  for (const modal of all) if (modal.parentId && owned.has(modal.parentId)) owned.add(modal.id);
  return all.filter(modal => modal.id !== id && owned.has(modal.id)).reverse();
}

function dismissCommitted(id: string, reason: ModalCloseReason): void {
  const modal = find(id);
  if (!modal || !isOpen(id)) return;
  for (const child of descendants(id)) dismissCommitted(child.id, 'parent-closed');
  closeAdmission.cancel(id);
  sessions.get(id)?.lifetime.abort();
  modalStore.send({ type: 'close', id });
  modal._settle?.({ kind: 'dismissed', reason });
  modal._resolve?.(false);
  notifyModalClosed(modal);
}

function accept(id: string, value: unknown): boolean {
  const modal = find(id);
  const session = sessions.get(id);
  if (retiring || !modal?.descriptor || !session || session.lifetime.signal.aborted || !isOpen(id)) return false;
  for (const child of descendants(id)) dismissCommitted(child.id, 'parent-closed');
  closeAdmission.cancel(id);
  sessions.get(id)?.lifetime.abort();
  modalStore.send({ type: 'close', id });
  modal._settle?.({ kind: 'accepted', value });
  modal._resolve?.(value === true);
  notifyModalClosed(modal);
  return true;
}

function validateDescriptor(descriptor: ModalDescriptor<unknown>): void {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) throw new TypeError('Modal descriptor must be an object.');
  if (typeof descriptor.title !== 'string' || !descriptor.title.trim()) throw new TypeError('A visible modal title is required.');
  if (descriptor.layout !== undefined && !['content', 'tabs', 'nav'].includes(descriptor.layout)) throw new TypeError('Unsupported modal layout.');
  if (descriptor.layout === 'tabs' || descriptor.layout === 'nav') {
    if ('body' in descriptor && descriptor.body !== undefined) throw new TypeError('Section modals cannot also supply a body.');
    if (!Array.isArray(descriptor.sections) || !descriptor.sections.length) throw new TypeError('Section modals require at least one panel.');
    assertIdentities(descriptor.sections, 'section');
    if (descriptor.initialSection !== undefined && !descriptor.sections.some(section => section.id === descriptor.initialSection)) {
      throw new TypeError('Initial modal section must identify a supplied panel.');
    }
  } else if (descriptor.sections !== undefined) throw new TypeError('Content modals cannot supply sections.');
  for (const [key, choices] of Object.entries({ size: ['xs', 'sm', 'md', 'lg', 'xl', 'full'],
    tone: ['default', 'info', 'success', 'danger'], placement: ['center', 'left', 'right', 'bottom'],
    height: ['auto', 'fixed'], scrollTreatment: ['arc', 'native'], scrollbar: ['auto', 'thin', 'hidden'], navScrollbar: ['auto', 'thin', 'hidden'] })) {
    const value = (descriptor as unknown as Record<string, unknown>)[key];
    if (value !== undefined && (typeof value !== 'string' || !choices.includes(value))) throw new TypeError(`Unsupported modal ${key}.`);
  }
  if (descriptor.actions !== undefined) {
    if (!Array.isArray(descriptor.actions)) throw new TypeError('Modal actions must be a list.');
    assertIdentities(descriptor.actions, 'action');
    for (const action of descriptor.actions) {
      if (action.variant !== undefined && !['primary', 'secondary', 'danger', 'ghost'].includes(action.variant)) throw new TypeError('Unsupported modal action variant.');
      if (action.role !== undefined && action.role !== 'cancel') throw new TypeError('Unsupported modal action role.');
      if (action.onClick !== undefined && typeof action.onClick !== 'function') throw new TypeError('Modal action onClick must be a function.');
      if (action.formId !== undefined && (typeof action.formId !== 'string' || !action.formId.trim())) throw new TypeError('Modal formId must be nonempty.');
      for (const key of ['submit', 'disabled', 'holdToConfirm', 'closes'] as const) {
        if (action[key] !== undefined && typeof action[key] !== 'boolean') throw new TypeError(`Modal action ${key} must be boolean.`);
      }
      if (action.holdDuration !== undefined && (!Number.isFinite(action.holdDuration) || action.holdDuration < 250 || action.holdDuration > 60_000)) {
        throw new TypeError('Modal holdDuration must be between 250 and 60000 milliseconds.');
      }
    }
  }
  if (descriptor.headerActions !== undefined) {
    if (!Array.isArray(descriptor.headerActions) || descriptor.headerActions.length > 2) throw new TypeError('Modal header accepts at most two actions.');
    assertIdentities(descriptor.headerActions, 'header action');
    if (descriptor.headerActions.some(action => typeof action.onClick !== 'function')) throw new TypeError('Modal header action requires a callback.');
  }
  for (const key of ['dismissible', 'guard', 'closeOnClickOutside', 'closeOnEscape', 'allowEditingWhilePending'] as const) {
    if (descriptor[key] !== undefined && typeof descriptor[key] !== 'boolean') throw new TypeError(`Modal ${key} must be boolean.`);
  }
  if (descriptor.beforeClose !== undefined && typeof descriptor.beforeClose !== 'function') throw new TypeError('Modal beforeClose must be a function.');
  if (descriptor.onCloseAutoFocus !== undefined && typeof descriptor.onCloseAutoFocus !== 'function') throw new TypeError('Modal onCloseAutoFocus must be a function.');
  validateModalMotionOptions(descriptor.motion);
}

function snapshotDescriptor(descriptor: ModalDescriptor<unknown>): ModalDescriptor<unknown> {
  return Object.freeze({ ...descriptor,
    motion: descriptor.motion ? Object.freeze({ ...descriptor.motion }) : undefined,
    customSize: descriptor.customSize ? Object.freeze({ ...descriptor.customSize }) : undefined,
    footer: descriptor.footer ? Object.freeze({ ...descriptor.footer }) : undefined,
    actions: descriptor.actions ? Object.freeze(descriptor.actions.map(action => Object.freeze({ ...action }))) : undefined,
    headerActions: descriptor.headerActions ? Object.freeze(descriptor.headerActions.map(action => Object.freeze({ ...action }))) : undefined,
    ...(descriptor.layout === 'tabs' || descriptor.layout === 'nav'
      ? { sections: Object.freeze(descriptor.sections.map(section => Object.freeze({ ...section }))) } : {}),
  }) as ModalDescriptor<unknown>;
}

function assertIdentities(items: readonly { id: string; label: string }[], kind: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.label !== 'string' || !item.label.trim() || ids.has(item.id)) {
      throw new TypeError(`Modal ${kind} identities and labels must be nonempty and unique.`);
    }
    ids.add(item.id);
  }
}

function guardedDescriptor(descriptor: ModalDescriptor<unknown>, id: string): ModalInstance['beforeClose'] {
  return context => {
    const current = find(id);
    if (!current?.descriptor || current.systemState?.busy) return false;
    const session = sessions.get(id);
    const boundGuards = session ? [...session.beforeCloseGuards.values()] : [];
    const guards = [...(descriptor.beforeClose ? [descriptor.beforeClose] : []), ...boundGuards];
    if (guards.length) return (async () => {
      for (const guard of guards) {
        if (!session || context.signal.aborted || !currentSession(id, session)) return false;
        if (await guard(context) !== true) return false;
      }
      return !context.signal.aborted && !!session && currentSession(id, session);
    })();
    if (descriptor.guard === false || !current.systemState?.dirty) return true;
    const child = getContext(id)!.show<boolean>({
      title: 'Discard unsaved changes?', description: 'Changes in this window have not been saved.',
      size: 'sm', role: 'alertdialog', tone: 'danger', guard: false, initialFocus: 'cancel',
      actions: [{ id: 'keep', label: 'Keep editing', role: 'cancel' },
        { id: 'discard', label: 'Discard changes', variant: 'danger', value: true }],
    });
    const cancel = () => retire(child.id);
    context.signal.addEventListener('abort', cancel, { once: true });
    if (context.signal.aborted) cancel();
    return child.result.then(result => {
      context.signal.removeEventListener('abort', cancel);
      return !context.signal.aborted && result.kind === 'accepted' && result.value === true;
    });
  };
}

/** Open legacy opaque content without changing its historical string-ID return type. */
function open(options: OpenModalOptions & { content: ReactNode }): string {
  const id = nextId();
  if (retiring) return id;
  modalStore.send({ type: 'open', modal: { ...options, id, type: 'content' } });
  return id;
}

/** Admit a structured modal with an exact-ID result and an owned child graph. */
function show<T = unknown>(descriptor: ModalDescriptor<T>): ModalHandle<T> {
  // Erasure is internal only: the handle restores T at the public admission boundary.
  validateDescriptor(descriptor as unknown as ModalDescriptor<unknown>);
  if (retiring) return retiredHandle<T>();
  const erased = snapshotDescriptor(descriptor as unknown as ModalDescriptor<unknown>);
  if (erased.parentId !== undefined && !isOpen(erased.parentId)) throw new TypeError('Modal parent must be an active owned instance.');
  const id = nextId();
  let resolve!: (result: ModalResult<T>) => void;
  let settled = false;
  const result = new Promise<ModalResult<T>>(yes => { resolve = yes; });
  const session = makeSession(id, 1);
  sessions.set(id, session);
  const modal: ModalInstance = {
    id, type: 'content', title: erased.title, descriptor: erased, parentId: erased.parentId, generation: 1,
    size: erased.size ?? 'md', customSize: erased.customSize, className: erased.className,
    showCloseButton: erased.dismissible !== false, closeOnClickOutside: erased.closeOnClickOutside,
    closeOnEscape: erased.closeOnEscape, onClose: erased.onClose,
    beforeClose: guardedDescriptor(erased, id),
    systemState: { busy: false, dirty: false, error: null, actionId: null, disabledActions: {} },
    _settle: outcome => {
      if (outcome.kind === 'retired') { closeAdmission.cancel(id); sessions.get(id)?.lifetime.abort(); sessions.delete(id); }
      if (settled) return;
      settled = true;
      resolve(outcome as ModalResult<T>);
    },
  };
  modalStore.send({ type: 'open', modal });
  return { id, result, close: value => accept(id, value), dismiss: reason => requestClose(id, { reason }),
    update: updates => updateDescriptor(id, updates as unknown as Partial<ModalDescriptor<unknown>>) };
}

/** Existing boolean confirmation now uses the common structured shell. */
function confirm(options: OpenConfirmOptions): Promise<boolean> {
  const handle = show<boolean>({
    title: options.title, description: options.description, size: options.size ?? 'sm',
    customSize: options.customSize, className: options.className,
    role: 'alertdialog', tone: options.variant === 'destructive' ? 'danger' : options.tone ?? 'default',
    icon: options.icon, motion: options.motion, trigger: options.trigger,
    guard: false, initialFocus: options.variant === 'destructive' || options.tone === 'danger' ? 'cancel' : 'primary',
    actions: [
      { id: 'cancel', label: options.cancelLabel ?? 'Cancel', role: 'cancel' },
      { id: 'confirm', label: options.confirmLabel ?? (options.holdToConfirm ? 'Hold to confirm' : 'Confirm'),
        variant: options.variant === 'destructive' ? 'danger' : 'primary', value: true,
        holdToConfirm: options.holdToConfirm, holdDuration: options.holdDuration },
    ],
  });
  modalStore.send({ type: 'update', id: handle.id, updates: { type: 'confirm', confirmOptions: options, from: options.from } });
  return handle.result.then(result => result.kind === 'accepted' && result.value === true);
}

/** Acknowledgment-only alert; it never infers or executes a domain operation. */
function alert(options: ModalDecisionOptions): Promise<void> {
  return show<boolean>({ ...options, role: 'alertdialog', size: 'sm', guard: false, initialFocus: 'primary',
    actions: [{ id: 'acknowledge', label: options.confirmLabel ?? 'OK', variant: 'primary', value: true }],
  }).result.then(() => undefined);
}

/** Validated single-field prompt; dismissal and retirement resolve null. */
function prompt(options: ModalPromptOptions): Promise<string | null> {
  return show(createModalPromptDescriptor(options)).result.then(result => result.kind === 'accepted' ? result.value : null);
}

/** Unlike a decision-only confirm, this waits for the caller's acknowledged work. */
function actionConfirm<T>(options: ModalActionConfirmOptions<T>): ModalHandle<T> {
  return show<T>({ ...options, role: 'alertdialog', size: 'sm', guard: false,
    initialFocus: options.tone === 'danger' ? 'cancel' : 'primary', actions: [
      { id: 'cancel', label: options.cancelLabel ?? 'Cancel', role: 'cancel' },
      { id: 'confirm', label: options.confirmLabel ?? 'Confirm', variant: options.tone === 'danger' ? 'danger' : 'primary',
        holdToConfirm: options.holdToConfirm, holdDuration: options.holdDuration, onClick: options.onConfirm },
    ] });
}

/** Read the current callback ownership context; retained exits may have an aborted context. */
function getContext(id: string): ModalContext<unknown> | undefined { return sessions.get(id)?.context; }

/**
 * Bind body-local form admission to an exact context lifetime without replacing
 * its descriptor. Descriptor guards run first, then retained form guards in order.
 * Registration changes cancel obsolete decisions; stale generations are inert.
 */
function bindBeforeClose(id: string, signal: AbortSignal, guard: ModalBeforeCloseGuard): () => void {
  const session = sessions.get(id);
  if (!session || session.lifetime.signal !== signal || !currentSession(id, session)) return () => {};
  if (typeof guard !== 'function') throw new TypeError('Modal beforeClose binding requires a guard.');
  closeAdmission.cancel(id);
  const token = Symbol('modal-before-close');
  session.beforeCloseGuards.set(token, guard);
  let removed = false;
  const unregister = () => {
    if (removed) return;
    removed = true;
    signal.removeEventListener('abort', unregister);
    if (session.beforeCloseGuards.delete(token) && sessions.get(id) === session) closeAdmission.cancel(id);
  };
  signal.addEventListener('abort', unregister, { once: true });
  return unregister;
}

/** Admit synchronously before invoking application code; repeated clicks do not replay it. */
async function performAction(id: string, actionId: string): Promise<boolean> {
  const modal = find(id), session = sessions.get(id);
  const action = modal?.descriptor?.actions?.find(value => value.id === actionId);
  const disabled = modal?.systemState?.disabledActions[actionId] ?? action?.disabled ?? false;
  if (!action || !session || !currentSession(id, session) || session.actionPending
    || modal?.systemState?.busy || disabled) return false;
  if (action.role === 'cancel') return requestClose(id, { reason: 'cancel' });
  closeAdmission.cancel(id);
  session.actionPending = true;
  patchState(id, session, { busy: true, actionId, error: null });
  try {
    const value = action.onClick ? await action.onClick(session.context) : action.value;
    if (!currentSession(id, session)) return false;
    session.actionPending = false;
    patchState(id, session, { busy: false, actionId: null });
    if ((action.onClick && value === false) || action.closes === false) return false;
    return accept(id, value === undefined ? (action.value === undefined ? true : action.value) : value);
  } catch {
    if (!currentSession(id, session)) return false;
    session.actionPending = false;
    patchState(id, session, { busy: false, actionId: null, error: 'Unable to complete this action. Please try again.' });
    reportFailure('action');
    return false;
  }
}

/** Header actions are acknowledged and generation-fenced, but do not implicitly accept. */
async function performHeaderAction(id: string, actionId: string): Promise<boolean> {
  const modal = find(id), session = sessions.get(id);
  const action = modal?.descriptor?.headerActions?.find(value => value.id === actionId);
  if (!action || !session || !currentSession(id, session) || session.actionPending || modal?.systemState?.busy) return false;
  closeAdmission.cancel(id);
  session.actionPending = true;
  patchState(id, session, { busy: true, actionId, error: null });
  try {
    await action.onClick(session.context);
    if (!currentSession(id, session)) return false;
    session.actionPending = false;
    patchState(id, session, { busy: false, actionId: null });
    return true;
  } catch {
    if (!currentSession(id, session)) return false;
    session.actionPending = false;
    patchState(id, session, { busy: false, actionId: null, error: 'Unable to complete this action. Please try again.' });
    reportFailure('header-action');
    return false;
  }
}

/** Advisory close admission; authoritative force bypasses busy/required/dirty guards. */
function requestClose(id: string, options?: ModalCloseOptions): Promise<boolean> {
  if (retiring) return Promise.resolve(false);
  const modal = find(id);
  if (!modal || !isOpen(id)) return Promise.resolve(false);
  if (modal.descriptor && !options?.force
    && (modal.descriptor.dismissible === false || modal.systemState?.busy)) return Promise.resolve(false);
  return closeAdmission.request(modal, options?.force, options?.reason ?? 'programmatic');
}

/** Retained void close delegates to exact-ID admission. */
function close(id: string, options?: ModalCloseOptions): void { void requestClose(id, options); }
/** Close only the latest active modal, never an already exiting one. */
function closeLast(options?: ModalCloseOptions): void {
  const last = [...state().modals].reverse().find(modal => isOpen(modal.id));
  if (last) close(last.id, options);
}

/** Close existing instances; legacy immediate behavior is retained when no guard exists. */
function closeAll(options?: ModalCloseOptions): void {
  const previous = state();
  if (!options?.force && previous.modals.some(modal => modal.descriptor
    ? !!modal.descriptor.beforeClose || !!sessions.get(modal.id)?.beforeCloseGuards.size
      || modal.descriptor.dismissible === false || modal.systemState?.busy
      || (modal.descriptor.guard !== false && modal.systemState?.dirty)
    : !!modal.beforeClose)) {
    for (const modal of [...previous.modals].reverse()) close(modal.id, options);
    return;
  }
  closeAdmission.cancelAll();
  for (const modal of previous.modals) modal._settle?.({ kind: 'dismissed', reason: options?.reason ?? 'programmatic' });
  modalStore.send({ type: 'closeAll' });
  for (const modal of previous.modals) {
    sessions.get(modal.id)?.lifetime.abort(); sessions.delete(modal.id);
    if (!previous.closingIds.includes(modal.id)) notifyModalClosed(modal);
  }
}

function retire(id: string): void {
  retiring++;
  try {
    for (const child of descendants(id)) retire(child.id);
    const modal = find(id);
    if (!modal) return;
    sessions.get(id)?.lifetime.abort(); sessions.delete(id);
    closeAdmission.cancel(id);
    modal._settle?.({ kind: 'retired' });
    modal._resolve?.(false);
    modalStore.send({ type: 'remove', id });
  } finally { retiring--; }
}

/** Scope retirement immediately suppresses old callbacks; it does not roll back server work. */
function discardAll(): void {
  retiring++;
  try {
    for (const session of sessions.values()) session.lifetime.abort();
    closeAdmission.cancelAll();
    sessions.clear();
    modalStore.send({ type: 'closeAll' });
  } finally { retiring--; }
}

/** Host teardown retires only its captured IDs, not dialogs admitted by a newer host. */
function disposeHost(ids: readonly string[] = state().modals.map(modal => modal.id)): void {
  for (const id of ids) retire(id);
}

/** Exact-generation visual removal; logical outcome has already settled. */
function completeExit(id: string, generation?: number): void {
  if (!state().closingIds.includes(id)) return;
  const modal = find(id);
  if (!modal || (generation !== undefined && modal.generation !== generation)) return;
  sessions.get(id)?.lifetime.abort(); sessions.delete(id);
  modalStore.send({ type: 'remove', id, generation });
}

function updateDescriptor(id: string, updates: Partial<ModalDescriptor<unknown>>): void {
  const modal = find(id);
  if (!modal?.descriptor || !isOpen(id)) return;
  const merged = { ...modal.descriptor, ...updates } as ModalDescriptor<unknown>;
  validateDescriptor(merged);
  const next = snapshotDescriptor(merged);
  if (next.parentId !== modal.parentId) throw new TypeError('An admitted modal cannot change its owner.');
  closeAdmission.cancel(id);
  for (const child of descendants(id)) dismissCommitted(child.id, 'parent-closed');
  sessions.get(id)?.lifetime.abort();
  const generation = (modal.generation ?? 0) + 1;
  sessions.set(id, makeSession(id, generation));
  modalStore.send({ type: 'update', id, updates: {
    descriptor: next, generation, title: next.title, size: next.size ?? 'md', customSize: next.customSize,
    className: next.className, onClose: next.onClose, beforeClose: guardedDescriptor(next, id),
    showCloseButton: next.dismissible !== false, closeOnClickOutside: next.closeOnClickOutside, closeOnEscape: next.closeOnEscape,
    systemState: { ...modal.systemState!, busy: false, actionId: null, error: null, disabledActions: {} },
  } });
}

/** Refresh controlled presentation without retiring native form state or pending acknowledgment. */
function projectPresentation<T = unknown>(id: string, signal: AbortSignal, updates: ModalPresentationUpdate<T>): void {
  const modal = find(id), session = sessions.get(id);
  if (!modal?.descriptor || !session || session.lifetime.signal !== signal || !currentSession(id, session)) return;
  const allowed = new Set(['title', 'meta', 'description', 'icon', 'tone', 'footer', 'actions', 'headerActions']);
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)
    || Reflect.ownKeys(updates).some(key => typeof key !== 'string' || !allowed.has(key))) throw new TypeError('Only modal presentation may be projected.');
  const merged = { ...modal.descriptor, ...updates } as unknown as ModalDescriptor<unknown>;
  validateDescriptor(merged);
  const descriptor = snapshotDescriptor(merged);
  const actionIds = new Set(descriptor.actions?.map(action => action.id));
  const disabledActions = Object.fromEntries(Object.entries(modal.systemState!.disabledActions).filter(([key]) => actionIds.has(key)));
  modalStore.send({ type: 'update', id, updates: { descriptor, title: descriptor.title,
    systemState: { ...modal.systemState!, disabledActions } } });
}

/** Legacy properties retain their update contract; structured handles update descriptors. */
function update(id: string, updates: Partial<OpenModalOptions>): void {
  if (!isOpen(id)) return;
  closeAdmission.cancel(id);
  modalStore.send({ type: 'update', id, updates });
}

export const modals = { open, show, confirm, alert, prompt, actionConfirm, getContext, bindBeforeClose, projectPresentation, performAction, performHeaderAction,
  close, requestClose, closeLast, closeAll, discardAll, update, completeExit, disposeHost } as const;
