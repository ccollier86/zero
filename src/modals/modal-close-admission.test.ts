/** Actual event/store guard admission, duplicate attempts, stale instances and security bypass. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { modals } from './modal-events';
import { modalStore } from './modal-store';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../frontend/client/observability';
function deferred() {
  let resolve!: (value: boolean) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
let events: FrontendObservabilityEvent[];
beforeEach(() => { events = []; configureFrontendObservability({ sink: { emit(value) { events.push(value); } } }); });
afterEach(() => { modals.discardAll(); configureFrontendObservability({ http: false, console: false }); });
describe('modal beforeClose admission', () => {
  test('unconfirmed dismissal stays open and guarded duplicate requests share one decision', async () => {
    const decision = deferred(); let asks = 0, closed = 0;
    const id = modals.open({ content: 'form', beforeClose: () => { asks++; return decision.promise; }, onClose: () => { closed++; } });
    const first = modals.requestClose(id), same = modals.requestClose(id); modals.close(id);
    expect(first).toBe(same); expect(asks).toBe(1); expect(modalStore.getSnapshot().context.closingIds).toEqual([]);
    decision.resolve(false); expect(await first).toBe(false); expect(closed).toBe(0);
    modals.update(id, { beforeClose: () => true }); expect(await modals.requestClose(id)).toBe(true);
    expect(closed).toBe(1); expect(await modals.requestClose(id)).toBe(false); expect(closed).toBe(1);
  });
  test('retirement immediately settles pending admission and suppresses late guard errors/callbacks', async () => {
    const decision = deferred(); let signal: AbortSignal | undefined, closed = 0;
    const id = modals.open({ content: 'private form', beforeClose: context => { signal = context.signal; return decision.promise; }, onClose: () => { closed++; } });
    const pending = modals.requestClose(id); modals.discardAll();
    expect(signal?.aborted).toBe(true); expect(await pending).toBe(false);
    decision.reject(new Error('RETIRED_PRIVATE_ERROR')); await Promise.resolve(); await Promise.resolve();
    expect(closed).toBe(0); expect(events).toEqual([]);
  });
  test('updated modal instance retires its old decision without closing the new instance', async () => {
    const decision = deferred(); let closed = 0;
    const id = modals.open({ content: 'before', beforeClose: () => decision.promise, onClose: () => { closed++; } });
    const pending = modals.requestClose(id); modals.update(id, { content: 'after', beforeClose: () => false });
    expect(await pending).toBe(false); decision.resolve(true); await Promise.resolve();
    expect(await modals.requestClose(id)).toBe(false); expect(closed).toBe(0);
    expect(modalStore.getSnapshot().context.modals[0]?.content).toBe('after');
  });
  test('force close bypasses and cancels guards while notifying only once', async () => {
    const decision = deferred(); let closed = 0;
    const id = modals.open({ content: 'form', beforeClose: () => decision.promise, onClose: () => { closed++; } });
    const pending = modals.requestClose(id); modals.close(id, { force: true });
    expect(await pending).toBe(false); expect(closed).toBe(1);
    decision.resolve(true); await Promise.resolve(); expect(closed).toBe(1);
  });
  test('current throwing guard stays open and emits safe code-only failure', async () => {
    const id = modals.open({ content: 'form', beforeClose: async () => { throw new Error('PRIVATE_GUARD_ERROR'); } });
    expect(await modals.requestClose(id)).toBe(false); expect(modalStore.getSnapshot().context.closingIds).toEqual([]);
    expect(events).toHaveLength(1); expect(events[0]?.metadata).toEqual({ surface: 'modal-manager', stage: 'before-close' });
    expect(JSON.stringify(events)).not.toContain('PRIVATE_GUARD_ERROR');
  });
});
