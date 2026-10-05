/** Store-level close callbacks cannot prevent dismissal or cancel other confirmations. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { modals } from './modal-events';
import { modalStore } from './modal-store';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../frontend/client/observability';

let events: FrontendObservabilityEvent[];
beforeEach(() => {
  events = [];
  configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
});
afterEach(() => { modals.discardAll(); configureFrontendObservability({ http: false, console: false }); });

describe('modal close callback isolation', () => {
  test('throwing content close still dismisses once without exposing private error text', () => {
    let calls = 0;
    const id = modals.open({ content: 'synthetic', onClose: () => { calls += 1; throw new Error('private callback contents'); } });
    expect(() => modals.close(id)).not.toThrow();
    expect(modalStore.getSnapshot().context.closingIds).toEqual([id]);
    modals.close(id);
    expect(calls).toBe(1);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('private callback contents');
  });

  test('recursive close of the same ID cannot re-enter its callback', () => {
    let calls = 0;
    let id = '';
    id = modals.open({ content: 'synthetic', onClose: () => { if (++calls < 4) modals.close(id); } });
    modals.close(id);
    expect(calls).toBe(1);
    expect(modalStore.getSnapshot().context.closingIds).toEqual([id]);
  });

  test('one failing close-all callback cannot strand another confirmation', async () => {
    let calls = 0;
    modals.open({ content: 'synthetic', onClose: () => { throw new Error('private close-all contents'); } });
    modals.open({ content: 'second', onClose: () => { calls += 1; } });
    const pending = modals.confirm({ title: 'Synthetic confirmation' });
    expect(() => modals.closeAll()).not.toThrow();
    expect(modalStore.getSnapshot().context.modals).toEqual([]);
    expect(calls).toBe(1);
    await expect(pending).resolves.toBe(false);
  });

  test('close-all does not call an already-closing callback twice', () => {
    let calls = 0;
    const id = modals.open({ content: 'synthetic', onClose: () => { calls += 1; } });
    modals.close(id);
    modals.closeAll();
    expect(calls).toBe(1);
  });

  test('content opened by a close callback is not accidentally discarded', () => {
    let nextId = '';
    modals.open({ content: 'synthetic', onClose: () => { nextId = modals.open({ content: 'new callback workflow' }); } });
    modals.closeAll();
    expect(modalStore.getSnapshot().context.modals.map((modal) => modal.id)).toEqual([nextId]);
  });

  test('an async rejected close notification cannot prevent dismissal or escape as unhandled', async () => {
    const id = modals.open({ content: 'synthetic', onClose: async () => { throw new Error('private async callback'); } });
    modals.close(id);
    await Promise.resolve();
    await Promise.resolve();
    expect(modalStore.getSnapshot().context.closingIds).toEqual([id]);
    expect(events[0]?.code).toBe('frontend.modal_callback.failed');
    expect(JSON.stringify(events)).not.toContain('private async callback');
  });
});
