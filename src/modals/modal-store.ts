import { createStore } from '@xstate/store';
import type { ModalInstance, ModalStoreState } from './modal.types';

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: ModalStoreState = {
  modals: [],
  closingIds: [],
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const modalStore = createStore({
  context: initialState,
  on: {
    open: (context, event: { modal: ModalInstance }) => ({
      ...context,
      modals: [...context.modals, event.modal],
    }),

    close: (context, event: { id: string }) => {
      const exists = context.modals.some((m) => m.id === event.id);
      if (!exists || context.closingIds.includes(event.id)) return context;

      return {
        ...context,
        closingIds: [...context.closingIds, event.id],
      };
    },

    remove: (context, event: { id: string }) => ({
      ...context,
      modals: context.modals.filter((m) => m.id !== event.id),
      closingIds: context.closingIds.filter((id) => id !== event.id),
    }),

    closeAll: (context) => {
      // Resolve any pending confirm modals
      for (const m of context.modals) {
        m._resolve?.(false);
      }
      return { ...context, modals: [], closingIds: [] };
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
