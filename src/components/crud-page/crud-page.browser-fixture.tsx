/** Synthetic receipt-controlled browser fixture; no app or transport is started. */

import React, { useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../../frontend/client/client-context';
import type { Client } from '../../frontend/client/sdk';
import { configureFrontendObservability } from '../../frontend/client/observability';
import { defineSchema, field } from '../../schema';
import { CrudPage } from './crud-page';
import { modals as modalApi } from '../../modals';
import { toast } from 'sonner';

type RecordRow = { key: string; name: string; notes?: string };
type Call = { action: string; id?: string; value?: unknown; aborted?: boolean };
type Modal = { id: string; content: ReactNode };
type Toast = { level: string; message: string };
const calls: Call[] = [];
const toasts: Toast[] = [];
const closes: string[] = [];
const created: RecordRow[] = [];
const deleted: string[] = [];
const observability: string[] = [];
let failTransform = false;
let failAcceptedCallback = false;
let modalSequence = 0;
let modals: Modal[] = [];
let renderModals = (_modals: Modal[]) => {};
let finishConfirm: ((value: boolean) => void) | null = null;
let confirmations = 0;
const receipts: Array<{ resolve(): void; reject(error: Error): void }> = [];
const listeners = new Set<() => void>();
let rows: Record<string, RecordRow> = { 'record-a': { key: 'record-a', name: 'Alpha', notes: 'Original' } };
const auth = {
  authorizationScopeKey: 'scope-a',
  user: { userId: 'user-a' },
  activeTenant: { tenantId: 'tenant-a' },
  isLoading: false,
  isAuthenticated: true,
  isRestoring: false,
  authorizationState: { status: 'ready' },
  sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
  subscribe(callback: () => void) { listeners.add(callback); return () => listeners.delete(callback); },
  subscribeAuthorization(callback: () => void) { listeners.add(callback); return () => listeners.delete(callback); },
};

function pending(action: string, id?: string, value?: unknown, options?: { signal?: AbortSignal }): Promise<void> {
  const call: Call = { action, id, value, aborted: false };
  calls.push(call);
  options?.signal?.addEventListener('abort', () => { call.aborted = true; }, { once: true });
  return new Promise<void>((resolve, reject) => receipts.push({ resolve, reject }));
}

const collection = {
  getAll: () => rows,
  subscribe(callback: () => void) { listeners.add(callback); return () => listeners.delete(callback); },
  insert(value: unknown) { calls.push({ action: 'optimistic-insert', value }); },
  update(id: string, value: unknown) { calls.push({ action: 'optimistic-update', id, value }); },
  remove(id: string) { calls.push({ action: 'optimistic-remove', id }); },
  insertAsync: (value: unknown, options?: { signal?: AbortSignal }) => pending('insert', undefined, value, options),
  updateAsync: (id: string, value: unknown, options?: { signal?: AbortSignal }) => pending('update', id, value, options),
  removeAsync: (id: string, options?: { signal?: AbortSignal }) => pending('remove', id, undefined, options),
  load(next: RecordRow[]) { rows = Object.fromEntries(next.map((row) => [row.key, row])); for (const callback of listeners) callback(); },
  clear() { rows = {}; for (const callback of listeners) callback(); },
};
const client = {
  auth,
  collection: () => collection,
  fetch: async () => ({ rows: Object.values(rows) }),
} as unknown as Client;
const schema = defineSchema({ name: field.text({ required: true }), notes: field.text() }, { pk: 'key' });
const container = document.getElementById('root')!;
const layout = container.dataset.layout === 'master-detail' ? 'master-detail' : 'table';
const lazy = container.dataset.lazy === 'true';
const root = createRoot(container);

const harness = {
  calls, toasts, closes, created, deleted, observability,
  openModal(options: { content: ReactNode }) {
    const id = `modal-${++modalSequence}`;
    modals = [...modals, { id, content: options.content }];
    renderModals(modals);
    return id;
  },
  closeModal(id: string) {
    closes.push(id);
    modals = modals.filter((modal) => modal.id !== id);
    renderModals(modals);
  },
  closeLast() { const last = modals.at(-1); if (last) harness.closeModal(last.id); },
  discardAll() { modals = []; renderModals(modals); finishConfirm?.(false); finishConfirm = null; },
  confirm() { confirmations += 1; return new Promise<boolean>((resolve) => { finishConfirm = resolve; }); },
  confirmationCount: () => confirmations,
  confirmPending: () => finishConfirm !== null,
  acceptConfirm(value: boolean) { finishConfirm?.(value); finishConfirm = null; },
  toast(level: string, message: string) { toasts.push({ level, message }); },
  resolveReceipt(index: number) { receipts[index]!.resolve(); },
  rejectReceipt(index: number) { receipts[index]!.reject(new Error('synthetic private rejection')); },
  modalIds: () => modals.map((modal) => modal.id),
  openUnrelatedModal() { return harness.openModal({ content: <p>Unrelated modal content</p> }); },
  switchScope() {
    Object.assign(auth, { authorizationScopeKey: 'scope-b', user: { userId: 'user-b' }, activeTenant: { tenantId: 'tenant-b' } });
    rows = { 'record-b': { key: 'record-b', name: 'Beta' } };
    harness.discardAll();
    for (const callback of listeners) callback();
  },
  unmount() { root.unmount(); },
  failTransform() { failTransform = true; },
  failAcceptedCallback() { failAcceptedCallback = true; },
};
declare global { interface Window { __crudTest: typeof harness } }
window.__crudTest = harness;
// Test doubles replace presentation only inside this isolated browser bundle.
Object.assign(modalApi, {
  open: harness.openModal, close: harness.closeModal, closeLast: harness.closeLast,
  discardAll: harness.discardAll, confirm: harness.confirm,
});
toast.success = ((message: string) => { harness.toast('success', message); return 'synthetic-toast'; }) as typeof toast.success;
toast.error = ((message: string) => { harness.toast('error', message); return 'synthetic-toast'; }) as typeof toast.error;
configureFrontendObservability({ sink: { emit: (event) => { observability.push(event.code); } } });

function Harness() {
  const [openModals, setOpenModals] = useState<Modal[]>([]);
  renderModals = setOpenModals;
  return (
    <ClientProvider client={client}>
      <CrudPage<RecordRow>
        table="records" schema={schema} columns={['name']} layout={layout} lazy={lazy}
        onBeforeCreate={(row) => { if (failTransform) throw new Error('synthetic private transform failure'); return { ...row, key: 'created-record' }; }}
        onBeforeUpdate={(_id, row) => ({ ...row, key: 'cannot-replace-key' })}
        onAfterCreate={(row) => { if (failAcceptedCallback) throw new Error('synthetic private callback failure'); created.push(row); }} onAfterDelete={(id) => deleted.push(id)}
      />
      {openModals.map((modal) => <div data-crud-modal={modal.id} key={modal.id}>{modal.content}</div>)}
    </ClientProvider>
  );
}
root.render(<Harness />);
