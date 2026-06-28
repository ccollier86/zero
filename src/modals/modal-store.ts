import { createStore } from '@xstate/store';
import type { ModalInstance, ModalStoreState } from './modal.types';

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: ModalStoreState = {
  modals: [],
  closingIndex: -1,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const modalStore = createStore({
  context: initialState,
  on: {
    open: (context, event: { modal: ModalInstance }) => ({
      ...context,
      modals: [...context.modals, event.modal],
      closingIndex: -1,
    }),

    close: (context, event: { id: string }) => {
      const idx = context.modals.findIndex((m) => m.id === event.id);
      if (idx === -1) return context;
      return { ...context, closingIndex: idx };
    },

    remove: (context, event: { id: string }) => ({
      ...context,
      modals: context.modals.filter((m) => m.id !== event.id),
      closingIndex: -1,
    }),

    closeAll: (context) => {
      // Resolve any pending confirm modals
      for (const m of context.modals) {
        m._resolve?.(false);
      }
      return { ...context, modals: [], closingIndex: -1 };
    },

    update: (
      context,
      event: { id: string; updates: Partial<ModalInstance> },
    ) => ({
      ...context,
      modals: context.modals.map((m) =>
        m.id === event.id ? { ...m, ...event.updates } : m,
      ),
    }),
  },
});
