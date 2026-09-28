import type { ReactNode } from 'react';
import { modalStore } from './modal-store';
import type {
  OpenModalOptions,
  OpenConfirmOptions,
  ModalInstance,
} from './modal.types';

// ─── ID Generator ────────────────────────────────────────────────────────────

let counter = 0;
function nextId(): string {
  return `modal-${++counter}-${Date.now().toString(36)}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Open a content modal. Returns the modal ID for programmatic close/update.
 *
 * @example
 * ```tsx
 * const id = modals.open({
 *   title: 'Edit User',
 *   content: <UserForm />,
 *   size: 'lg',
 * });
 *
 * // later:
 * modals.close(id);
 * ```
 */
function open(options: OpenModalOptions & { content: ReactNode }): string {
  const id = nextId();
  const modal: ModalInstance = {
    ...options,
    id,
    type: 'content',
  };
  modalStore.send({ type: 'open', modal });
  return id;
}

/**
 * Open a confirm dialog. Returns a Promise that resolves to true (confirmed)
 * or false (cancelled/dismissed).
 *
 * @example
 * ```tsx
 * const confirmed = await modals.confirm({
 *   title: 'Delete record?',
 *   description: 'This cannot be undone.',
 *   variant: 'destructive',
 *   holdToConfirm: true,
 * });
 * if (confirmed) deleteRecord();
 * ```
 */
function confirm(options: OpenConfirmOptions): Promise<boolean> {
  const id = nextId();
  return new Promise<boolean>((resolve) => {
    const modal: ModalInstance = {
      id,
      type: 'confirm',
      title: options.title,
      size: options.size ?? 'sm',
      customSize: options.customSize,
      from: options.from,
      className: options.className,
      confirmOptions: options,
      _resolve: resolve,
    };
    modalStore.send({ type: 'open', modal });
  });
}

/**
 * Close a specific modal by ID. Triggers exit animation.
 */
function close(id: string): void {
  const state = modalStore.getSnapshot().context;
  const modal = state.modals.find((m) => m.id === id);
  if (!modal || state.closingIds.includes(id)) return;

  modal._resolve?.(false);
  modal.onClose?.();
  modalStore.send({ type: 'close', id });
}

/**
 * Close the topmost modal.
 */
function closeLast(): void {
  const state = modalStore.getSnapshot().context;
  const last = [...state.modals]
    .reverse()
    .find((modal) => !state.closingIds.includes(modal.id));
  if (last) close(last.id);
}

/**
 * Close all open modals.
 */
function closeAll(): void {
  const state = modalStore.getSnapshot().context;
  for (const m of state.modals) {
    m.onClose?.();
  }
  modalStore.send({ type: 'closeAll' });
}

/**
 * Immediately discard modal content without invoking app-owned close
 * callbacks. Authorization-scope replacement uses this so tenant-A callbacks
 * cannot run after tenant B becomes active. Pending confirms resolve `false`
 * inside the store.
 */
function discardAll(): void {
  modalStore.send({ type: 'closeAll' });
}

/**
 * Update an open modal's properties.
 */
function update(id: string, updates: Partial<OpenModalOptions>): void {
  modalStore.send({ type: 'update', id, updates });
}

export const modals = {
  open,
  confirm,
  close,
  closeLast,
  closeAll,
  discardAll,
  update,
} as const;
