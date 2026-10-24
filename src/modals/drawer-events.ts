/** Public drawer facade over the existing exact-ID modal store; owns no independent overlay stack. */
import { modals } from './modal-events';
import { modalStore } from './modal-store';
import type { ModalDescriptor } from './modal-system.types';
import type { DrawerDescriptor, DrawerHandle, ModalDrawerPresentation } from './drawer-types';

/** Convert public drawer options into one canonical, validated modal-owned descriptor. */
export function drawerModalDescriptor<T>(descriptor: DrawerDescriptor<T>): ModalDescriptor<T> {
  const { side = 'right', mode = descriptor.container ? 'nonmodal' : 'modal', mobile = 'bottom-sheet', container,
    reserveSpace = false, width = 'var(--zero-drawer-width,24rem)', sheetHeight = 'var(--zero-drawer-sheet-height,85dvh)', motion, ...rest } = descriptor;
  const drawer: ModalDrawerPresentation = { side, mode, mobile, container, reserveSpace, width, sheetHeight,
    narrow: typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches };
  return { ...rest, drawer, placement: side, height: 'fixed', dataSlot: rest.dataSlot ?? 'drawer',
    closeOnClickOutside: rest.closeOnClickOutside ?? mode === 'modal',
    motion: { pageRecedes: false, ...motion, entrance: 'rise' } } as ModalDescriptor<T>;
}

function show<T>(descriptor: DrawerDescriptor<T>): DrawerHandle<T> {
  let current = descriptor;
  const handle = modals.show(drawerModalDescriptor(descriptor));
  return {
    id: handle.id, result: handle.result, close: handle.close, dismiss: handle.dismiss,
    update(updates) {
      const next = { ...current, ...updates } as DrawerDescriptor<T>;
      handle.update(drawerModalDescriptor(next)); current = next;
    },
    async replace<U>(replacement: DrawerDescriptor<U>): Promise<DrawerHandle<U> | null> {
      if (!await handle.dismiss('programmatic')) return null;
      const state = modalStore.getSnapshot().context;
      // A scope/workspace retirement removes this entry immediately. Normal
      // guarded dismissal retains it for exit paint, preserving this proof.
      if (!state.modals.some(item => item.id === handle.id) || !state.closingIds.includes(handle.id)) return null;
      if (current.container && !current.container.isConnected) return null;
      const { side, mode, mobile, reserveSpace, width, sheetHeight, motion } = current;
      return show({ side, mode, mobile, reserveSpace, width, sheetHeight, motion, ...replacement,
        container: replacement.container === undefined ? current.container : replacement.container,
        parentId: replacement.parentId ?? current.parentId });
    },
  };
}

export const drawers = Object.freeze({
  show,
  dismiss(id: string) {
    return modalStore.getSnapshot().context.modals.some(item => item.id === id && item.descriptor?.drawer)
      ? modals.requestClose(id, { reason: 'programmatic' }) : Promise.resolve(false);
  },
});
