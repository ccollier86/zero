/** Structured admission/results/actions and lifecycle races, without a DOM or live services. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { modals } from './modal-events';
import { modalStore } from './modal-store';
import type { ModalDescriptor } from './modal-system.types';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../frontend/client/observability';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const find = (id: string) => modalStore.getSnapshot().context.modals.find(modal => modal.id === id);
let events: FrontendObservabilityEvent[];
beforeEach(() => { modals.discardAll(); events = []; configureFrontendObservability({ sink: { emit(event) { events.push(event); } } }); });
afterEach(() => { modals.discardAll(); configureFrontendObservability({ http: false, console: false }); });

describe('structured modal contracts', () => {
  test('legacy content returns a string; structured result accepts once before visual removal', async () => {
    expect(typeof modals.open({ content: 'Legacy' })).toBe('string');
    const handle = modals.show<number>({ title: 'Picker' });
    expect(handle.close(42)).toBe(true);
    expect(handle.close(50)).toBe(false);
    expect(await handle.result).toEqual({ kind: 'accepted', value: 42 });
    expect(find(handle.id)).toBeDefined();
    modals.completeExit(handle.id, 1);
    expect(find(handle.id)).toBeUndefined();
  });
  test('dismiss and retirement are distinct; retirement does not notify stale callbacks', async () => {
    let calls = 0;
    const dismissed = modals.show({ title: 'Dismiss', onClose: () => calls++ });
    expect(await dismissed.dismiss('escape')).toBe(true);
    expect(await dismissed.result).toEqual({ kind: 'dismissed', reason: 'escape' });
    const retired = modals.show({ title: 'Retire', onClose: () => calls++ });
    modals.discardAll();
    expect(await retired.result).toEqual({ kind: 'retired' });
    expect(calls).toBe(1);
  });
  test('runtime rejects invalid layouts, identities, defaults and motion before allocating a modal', () => {
    for (const descriptor of [
      { title: ' ' }, { title: 'Test', layout: 'tabs', sections: [] },
      { title: 'Test', layout: 'tabs', body: 'Invalid', sections: [{ id: 'a', label: 'A', body: 'A' }] },
      { title: 'Test', actions: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] },
      { title: 'Test', motion: { durationMultiplier: Infinity } },
      { title: 'Test', motion: { entrance: 'invalid' } },
      { title: 'Test', size: 'invalid' }, { title: 'Test', allowEditingWhilePending: 'true' },
      { title: 'Test', actions: [{ id: 'a', label: 'A', onClick: 'not a callback' }] },
    ]) expect(() => modals.show(descriptor as unknown as ModalDescriptor)).toThrow();
    expect(modalStore.getSnapshot().context.modals).toEqual([]);
  });
  test('admission snapshots options instead of retaining externally mutable arrays', async () => {
    const actions = [{ id: 'accept', label: 'Accept', value: 7 }];
    const handle = modals.show({ title: 'Snapshot', actions });
    actions[0]!.value = 100;
    actions.push({ id: 'later', label: 'Later', value: 1 });
    expect(await modals.performAction(handle.id, 'accept')).toBe(true);
    expect(await handle.result).toEqual({ kind: 'accepted', value: 7 });
  });
  test('pending action admits synchronously and close/action attempts cannot replay it', async () => {
    const work = deferred<number>(); let calls = 0;
    const handle = modals.show<number>({ title: 'Save', actions: [{ id: 'save', label: 'Save', onClick: () => { calls++; return work.promise; } }] });
    const first = modals.performAction(handle.id, 'save');
    expect(find(handle.id)?.systemState?.busy).toBe(true);
    expect(await modals.performAction(handle.id, 'save')).toBe(false);
    expect(await handle.dismiss('escape')).toBe(false);
    expect(calls).toBe(1);
    work.resolve(123);
    expect(await first).toBe(true);
    expect(await handle.result).toEqual({ kind: 'accepted', value: 123 });
  });
  test('failed action uses a safe error and permits deliberate retry without leaking raw contents', async () => {
    let calls = 0;
    const handle = modals.show({ title: 'Save', actions: [{ id: 'save', label: 'Save', onClick: async () => { calls++; throw new Error('PRIVATE_SERVER_TOKEN'); } }] });
    expect(await modals.performAction(handle.id, 'save')).toBe(false);
    expect(find(handle.id)?.systemState?.busy).toBe(false);
    expect(find(handle.id)?.systemState?.error).toBe('Unable to complete this action. Please try again.');
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_SERVER_TOKEN');
    expect(await modals.performAction(handle.id, 'save')).toBe(false);
    expect(calls).toBe(2);
  });
  test('false and closes:false retain the modal; explicit accepted false remains representable', async () => {
    const handle = modals.show<boolean>({ title: 'Keep open', actions: [
      { id: 'invalid', label: 'Invalid', onClick: () => false },
      { id: 'keep', label: 'Keep', closes: false, onClick: () => true },
      { id: 'no', label: 'No', value: false },
    ] });
    expect(await modals.performAction(handle.id, 'invalid')).toBe(false);
    expect(await modals.performAction(handle.id, 'keep')).toBe(false);
    expect(find(handle.id)?.systemState?.busy).toBe(false);
    expect(await modals.performAction(handle.id, 'no')).toBe(true);
    expect(await handle.result).toEqual({ kind: 'accepted', value: false });
  });
  test('action retirement aborts ownership and suppresses late errors and writes to projection', async () => {
    const work = deferred<number>();
    const handle = modals.show<number>({ title: 'Save', actions: [{ id: 'save', label: 'Save', onClick: () => work.promise }] });
    const context = modals.getContext(handle.id)!;
    const pending = modals.performAction(handle.id, 'save');
    modals.discardAll();
    expect(context.signal.aborted).toBe(true);
    expect(await handle.result).toEqual({ kind: 'retired' });
    work.reject(new Error('RETIRED_ERROR'));
    expect(await pending).toBe(false);
    context.setError('Old error');
    expect(context.accept(99)).toBe(false);
    expect(events).toEqual([]);
    expect(modalStore.getSnapshot().context.modals).toEqual([]);
  });
  test('descriptor replacement retires old action context, keeps the handle and accepts new work', async () => {
    const old = deferred<number>();
    const handle = modals.show<number>({ title: 'Before', actions: [{ id: 'save', label: 'Save', onClick: () => old.promise }] });
    const before = modals.getContext(handle.id)!;
    const pending = modals.performAction(handle.id, 'save');
    handle.update({ title: 'After', actions: [{ id: 'save', label: 'Save', onClick: () => 2 }] });
    expect(before.signal.aborted).toBe(true);
    expect(find(handle.id)?.systemState?.busy).toBe(false);
    before.setError('Stale'); expect(find(handle.id)?.systemState?.error).toBeNull();
    old.resolve(1); expect(await pending).toBe(false);
    expect(await modals.performAction(handle.id, 'save')).toBe(true);
    expect(await handle.result).toEqual({ kind: 'accepted', value: 2 });
  });
  test('state projection updates do not invalidate exact-generation close admission', async () => {
    const guard = deferred<boolean>(); let asks = 0;
    const handle = modals.show({ title: 'Guarded', beforeClose: () => { asks++; return guard.promise; } });
    const first = handle.dismiss('backdrop');
    modals.getContext(handle.id)!.setDirty(true);
    modals.getContext(handle.id)!.setError('Safe');
    expect(handle.dismiss('escape')).toBe(first);
    guard.resolve(true);
    expect(await first).toBe(true);
    expect(asks).toBe(1);
    expect(await handle.result).toEqual({ kind: 'dismissed', reason: 'backdrop' });
  });
  test('superseding a descriptor cancels its pending guard without stranding the result', async () => {
    const guard = deferred<boolean>(); let signal: AbortSignal | undefined;
    const handle = modals.show({ title: 'Guarded', beforeClose: context => { signal = context.signal; return guard.promise; } });
    const first = handle.dismiss();
    handle.update({ beforeClose: () => true });
    expect(signal?.aborted).toBe(true); expect(await first).toBe(false);
    guard.resolve(true); await Promise.resolve();
    expect(find(handle.id)).toBeDefined();
    expect(await handle.dismiss('close-button')).toBe(true);
    expect(await handle.result).toEqual({ kind: 'dismissed', reason: 'close-button' });
  });
  test('dirty generic dialog has one owned discard decision and Keep editing retains it', async () => {
    const parent = modals.show({ title: 'Draft' });
    modals.getContext(parent.id)!.setDirty(true);
    const first = parent.dismiss();
    expect(parent.dismiss()).toBe(first);
    const child = modalStore.getSnapshot().context.modals.at(-1)!;
    expect(child.parentId).toBe(parent.id);
    expect(await modals.performAction(child.id, 'keep')).toBe(true);
    expect(await first).toBe(false);
    const second = parent.dismiss();
    const decision = modalStore.getSnapshot().context.modals.at(-1)!;
    expect(await modals.performAction(decision.id, 'discard')).toBe(true);
    expect(await second).toBe(true);
    expect(await parent.result).toEqual({ kind: 'dismissed', reason: 'programmatic' });
  });
  test('retiring or replacing a pending dirty decision removes the exact child', async () => {
    const parent = modals.show({ title: 'Draft' });
    modals.getContext(parent.id)!.setDirty(true);
    const first = parent.dismiss();
    const childId = modalStore.getSnapshot().context.modals.at(-1)!.id;
    parent.update({ title: 'Replacement', guard: false });
    expect(await first).toBe(false);
    expect(find(childId)).toBeUndefined();
    expect(await parent.dismiss()).toBe(true);
  });
  test('closing parent settles its child graph but leaves an unrelated modal open', async () => {
    const parent = modals.show({ title: 'Parent' });
    const child = modals.getContext(parent.id)!.show({ title: 'Child', dismissible: false });
    const grandchild = modals.getContext(child.id)!.show({ title: 'Grandchild' });
    const unrelated = modals.show({ title: 'Unrelated' });
    parent.close('saved');
    expect(await child.result).toEqual({ kind: 'dismissed', reason: 'parent-closed' });
    expect(await grandchild.result).toEqual({ kind: 'dismissed', reason: 'parent-closed' });
    expect(modals.getContext(child.id)?.signal.aborted).toBe(true);
    expect(modalStore.getSnapshot().context.closingIds).not.toContain(unrelated.id);
    expect(await unrelated.dismiss()).toBe(true);
  });
  test('host teardown captured IDs cannot retire a newer unrelated modal', async () => {
    const old = modals.show({ title: 'Old host' });
    const next = modals.show({ title: 'New host' });
    modals.disposeHost([old.id]);
    expect(await old.result).toEqual({ kind: 'retired' });
    expect(find(next.id)).toBeDefined();
    next.close(true); expect((await next.result).kind).toBe('accepted');
  });
  test('stale exit generation cannot remove an updated instance or newer ID', async () => {
    const handle = modals.show({ title: 'Before' });
    handle.update({ title: 'After' }); handle.close(true);
    modals.completeExit(handle.id, 1); expect(find(handle.id)).toBeDefined();
    modals.completeExit(handle.id, 2); expect(find(handle.id)).toBeUndefined();
    expect(await handle.result).toEqual({ kind: 'accepted', value: true });
  });
  test('required and externally busy modals deny advisory close but retirement always succeeds', async () => {
    const handle = modals.show({ title: 'Required', dismissible: false });
    expect(await handle.dismiss('escape')).toBe(false);
    modals.getContext(handle.id)!.setBusy(true);
    expect(await modals.requestClose(handle.id, { force: true })).toBe(true);
    expect(await handle.result).toEqual({ kind: 'dismissed', reason: 'programmatic' });
  });
  test('cancelled context cannot admit children after replacement or retirement', async () => {
    const handle = modals.show({ title: 'Owner' });
    const context = modals.getContext(handle.id)!;
    handle.update({ title: 'New owner' });
    const child = context.show({ title: 'Old late child' });
    expect(await child.result).toEqual({ kind: 'retired' });
    expect(modalStore.getSnapshot().context.modals).toHaveLength(1);
  });
  test('synchronous abort listeners cannot accept or readmit a retiring scope', async () => {
    let calls = 0, lateChild: ReturnType<typeof modals.show> | undefined;
    const handle = modals.show({ title: 'Retiring', onClose: () => calls++ });
    modals.getContext(handle.id)!.signal.addEventListener('abort', () => {
      expect(handle.close('old receipt')).toBe(false);
      lateChild = modals.show({ title: 'Late old-scope child' });
      modals.open({ content: 'Late legacy child' });
      modals.close(handle.id, { force: true });
    });
    modals.discardAll();
    expect(await handle.result).toEqual({ kind: 'retired' });
    expect(await lateChild!.result).toEqual({ kind: 'retired' });
    expect(calls).toBe(0);
    expect(modalStore.getSnapshot().context.modals).toEqual([]);
    const current = modals.show({ title: 'Current scope' });
    expect(current.close(true)).toBe(true);
  });
  test('body-local form guards compose after descriptor admission without replacing context', async () => {
    const calls: string[] = [];
    const handle = modals.show({ title: 'Forms', beforeClose: () => { calls.push('descriptor'); return true; } });
    const context = modals.getContext(handle.id)!;
    context.setDirty(true);
    const one = modals.bindBeforeClose(handle.id, context.signal, () => { calls.push('one'); return true; });
    const two = modals.bindBeforeClose(handle.id, context.signal, () => { calls.push('two'); return false; });
    expect(await handle.dismiss()).toBe(false);
    expect(calls).toEqual(['descriptor', 'one', 'two']);
    expect(modalStore.getSnapshot().context.modals).toHaveLength(1);
    two();
    expect(await handle.dismiss()).toBe(true);
    expect(calls).toEqual(['descriptor', 'one', 'two', 'descriptor', 'one']);
    one();
  });
  test('unregister cancels exact pending form admission and clears its owned child decision', async () => {
    const handle = modals.show({ title: 'Form' });
    const context = modals.getContext(handle.id)!;
    let childId = '';
    const unregister = modals.bindBeforeClose(handle.id, context.signal, close => {
      const child = context.show({ title: 'Save, discard or stay' }); childId = child.id;
      const stop = () => modals.disposeHost([child.id]);
      close.signal.addEventListener('abort', stop, { once: true });
      return child.result.then(result => { close.signal.removeEventListener('abort', stop); return result.kind === 'accepted'; });
    });
    const decision = handle.dismiss();
    expect(find(childId)).toBeDefined();
    unregister();
    expect(await decision).toBe(false); expect(find(childId)).toBeUndefined();
    expect(await handle.dismiss()).toBe(true);
  });
  test('old form binding and stale unregister cannot affect a replacement generation', async () => {
    const handle = modals.show({ title: 'Form' });
    const context = modals.getContext(handle.id)!;
    let calls = 0;
    const unregisterOld = modals.bindBeforeClose(handle.id, context.signal, () => { calls++; return false; });
    handle.update({ title: 'Replacement' });
    const stale = modals.bindBeforeClose(handle.id, context.signal, () => { calls++; return false; });
    const decision = deferred<boolean>();
    const unregisterNew = modals.bindBeforeClose(handle.id, modals.getContext(handle.id)!.signal, () => decision.promise);
    const pending = handle.dismiss();
    stale(); unregisterOld();
    decision.resolve(true);
    expect(await pending).toBe(true); expect(calls).toBe(0);
    unregisterNew();
  });
  test('controlled presentation can add actions while keeping exact form context and guards', async () => {
    const handle = modals.show({ title: 'Before' });
    const context = modals.getContext(handle.id)!;
    let guards = 0;
    modals.bindBeforeClose(handle.id, context.signal, () => { guards++; return false; });
    modals.projectPresentation(handle.id, context.signal, { title: 'After', footer: { start: 'Ready' },
      actions: [{ id: 'new', label: 'New action', value: 'accepted' }] });
    expect(modals.getContext(handle.id)).toBe(context);
    expect(find(handle.id)?.generation).toBe(1);
    expect(await handle.dismiss()).toBe(false); expect(guards).toBe(1);
    expect(await modals.performAction(handle.id, 'new')).toBe(true);
    expect(await handle.result).toEqual({ kind: 'accepted', value: 'accepted' });
  });
  test('live presentation replacement never replays or abandons the captured pending action', async () => {
    const pending = deferred<string>(); let calls = 0;
    const handle = modals.show({ title: 'Save', actions: [{ id: 'save', label: 'Save', onClick: () => { calls++; return pending.promise; } }] });
    const context = modals.getContext(handle.id)!;
    const action = modals.performAction(handle.id, 'save');
    modals.projectPresentation(handle.id, context.signal, { actions: [{ id: 'other', label: 'Other', onClick: () => { calls++; return 'other'; } }] });
    expect(find(handle.id)?.systemState?.busy).toBe(true);
    expect(await modals.performAction(handle.id, 'other')).toBe(false);
    pending.resolve('original receipt'); expect(await action).toBe(true);
    expect(await handle.result).toEqual({ kind: 'accepted', value: 'original receipt' }); expect(calls).toBe(1);
  });
  test('presentation rejects structural options and ignores obsolete signal ownership', () => {
    const handle = modals.show({ title: 'First' });
    const context = modals.getContext(handle.id)!;
    expect(() => modals.projectPresentation(handle.id, context.signal, { size: 'lg' } as never)).toThrow();
    expect(() => modals.projectPresentation(handle.id, context.signal, { actions: [{ id: '', label: 'Invalid' }] })).toThrow();
    handle.update({ title: 'Replacement' });
    modals.projectPresentation(handle.id, context.signal, { title: 'Stale' });
    expect(find(handle.id)?.title).toBe('Replacement');
  });
  test('retirement aborts bound form decisions without authorizing late close callbacks', async () => {
    const handle = modals.show({ title: 'Form' });
    let closed = 0, closeSignal: AbortSignal | undefined;
    const decision = deferred<boolean>();
    modals.bindBeforeClose(handle.id, modals.getContext(handle.id)!.signal, close => {
      closeSignal = close.signal; return decision.promise;
    });
    handle.update({ onClose: () => { closed++; } });
    modals.bindBeforeClose(handle.id, modals.getContext(handle.id)!.signal, close => {
      closeSignal = close.signal; return decision.promise;
    });
    const pending = handle.dismiss();
    modals.discardAll();
    expect(closeSignal?.aborted).toBe(true); expect(await pending).toBe(false);
    expect(await handle.result).toEqual({ kind: 'retired' });
    decision.resolve(true); await Promise.resolve(); expect(closed).toBe(0);
  });
  test('disabled actions and cancel results are explicit', async () => {
    const handle = modals.show({ title: 'Choices', actions: [
      { id: 'save', label: 'Save', value: 1 }, { id: 'cancel', label: 'Cancel', role: 'cancel' },
    ] });
    modals.getContext(handle.id)!.setActionDisabled('save', true);
    expect(await modals.performAction(handle.id, 'save')).toBe(false);
    expect(await modals.performAction(handle.id, 'cancel')).toBe(true);
    expect(await handle.result).toEqual({ kind: 'dismissed', reason: 'cancel' });
  });
  test('legacy boolean confirmations use structured safe focus and retain hold interval', async () => {
    const promise = modals.confirm({ title: 'Delete?', variant: 'destructive', holdToConfirm: true, holdDuration: 1500 });
    const modal = modalStore.getSnapshot().context.modals.at(-1)!;
    expect(modal.descriptor?.initialFocus).toBe('cancel');
    expect(modal.descriptor?.actions?.[1]?.holdDuration).toBe(1500);
    await modals.performAction(modal.id, 'confirm');
    expect(await promise).toBe(true);
  });
  test('dynamic action admission can deliberately enable an initially disabled action', async () => {
    const handle = modals.show({ title: 'Validating', actions: [{ id: 'save', label: 'Save', disabled: true, value: 'saved' }] });
    expect(await modals.performAction(handle.id, 'save')).toBe(false);
    modals.getContext(handle.id)!.setActionDisabled('save', false);
    expect(await modals.performAction(handle.id, 'save')).toBe(true);
    expect(await handle.result).toEqual({ kind: 'accepted', value: 'saved' });
  });
  test('action-backed confirmation waits for actual writer; alert shares the same shell', async () => {
    const work = deferred<string>();
    const handle = modals.actionConfirm({ title: 'Delete?', tone: 'danger', onConfirm: () => work.promise });
    const pending = modals.performAction(handle.id, 'confirm');
    expect(find(handle.id)?.systemState?.busy).toBe(true);
    work.resolve('receipt'); expect(await pending).toBe(true);
    expect(await handle.result).toEqual({ kind: 'accepted', value: 'receipt' });
    const alert = modals.alert({ title: 'Export complete' });
    const modal = modalStore.getSnapshot().context.modals.at(-1)!;
    expect(modal.descriptor?.role).toBe('alertdialog');
    await modals.performAction(modal.id, 'acknowledge'); await alert;
  });
});
