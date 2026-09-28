/**
 * modal-store.test.ts
 *
 * Verifies modal stack lifecycle behavior. Rendering is covered by app/browser
 * smoke tests; this file owns store-level close/open regression coverage.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { modals } from './modal-events';
import { modalStore } from './modal-store';

describe('modal store', () => {
  afterEach(() => {
    modals.closeAll();
  });

  test('keeps closing modals closed when a new modal opens before removal', () => {
    const cardId = modals.open({ title: 'Edit card', content: 'card' });

    modals.close(cardId);
    expect(modalStore.getSnapshot().context.closingIds).toEqual([cardId]);

    const categoryId = modals.open({ title: 'New category', content: 'category' });
    const state = modalStore.getSnapshot().context;

    expect(state.modals.map((modal) => modal.id)).toEqual([cardId, categoryId]);
    expect(state.closingIds).toEqual([cardId]);

    modalStore.send({ type: 'remove', id: cardId });
    expect(modalStore.getSnapshot().context.modals.map((modal) => modal.id)).toEqual([categoryId]);
    expect(modalStore.getSnapshot().context.closingIds).toEqual([]);
  });

  test('closeLast ignores modals already closing', () => {
    const boardId = modals.open({ title: 'Edit board', content: 'board' });
    const cardId = modals.open({ title: 'Edit card', content: 'card' });

    modals.close(cardId);
    modals.closeLast();

    expect(modalStore.getSnapshot().context.closingIds).toEqual([cardId, boardId]);
  });

  test('discardAll resolves confirms safely without invoking stale close callbacks', async () => {
    let closeCalls = 0;
    modals.open({
      title: 'Tenant-scoped content',
      content: 'secret',
      onClose: () => {
        closeCalls += 1;
      },
    });
    const confirmation = modals.confirm({ title: 'Tenant-scoped confirmation' });

    modals.discardAll();

    expect(modalStore.getSnapshot().context.modals).toEqual([]);
    expect(modalStore.getSnapshot().context.closingIds).toEqual([]);
    await expect(confirmation).resolves.toBe(false);
    expect(closeCalls).toBe(0);
  });
});
