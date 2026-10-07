/** Controlled synthetic settings acknowledgments under real Guardian form boundaries; no account writes. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../../frontend/client/client-context';
import type { Client } from '../../frontend/client/sdk';
import { AuthorizationDataBoundaryController } from '../../frontend/client/authorization-data-boundary';
import { configureFrontendObservability } from '../../frontend/client/observability';
import { defineSchema, field } from '../../schema';
import { useForm } from '../../hooks/use-form';
import type { FormSubmissionAcceptance } from '../../hooks/form-save-types';
import { useFormSave } from '../../hooks/use-form-save';
import { FormSaveBar, UnsavedChangesDialog } from './index';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { RouterProvider, useRouter, usePathname } from '../../frontend/client/router-context';
import { ModalManager, modals } from '../../modals';
import { modalStore } from '../../modals/modal-store';

const listeners = new Set<() => void>();
const data = new AuthorizationDataBoundaryController();
let scope = 'a';
const auth = { user: { userId: 'test-user' }, activeTenant: { tenantId: 'a' },
  isAuthenticated: true, isLoading: false, isRestoring: false, authorizationState: { status: 'ready' },
  get authorizationScopeKey() { return scope; },
  sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  subscribeAuthorization(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
const client = { auth, _authorizationDataBoundary: data } as unknown as Client;
const schema = defineSchema({ title: field.text({ required: true }), bio: field.text({ required: true }) });
const calls: { values: Record<string, unknown>; signal: AbortSignal; expectedRevision?: string | number;
  resolve: (value: FormSubmissionAcceptance) => void; reject: (cause: unknown) => void }[] = [];
let continued = 0;
let modalClosed = 0, modalId = '';
const harness = { calls, continued: () => continued,
  resolve(index: number, canonical?: string) { calls[index]!.resolve({ values: { ...calls[index]!.values, ...(canonical ? { title: canonical } : {}) }, revision: index + 2 }); },
  reject(index: number) { calls[index]!.reject(new Error('NEVER_RENDER_OR_LOG')); },
  editDuringSave: (_value: string) => {},
  push: (_path: string, _bypass = false) => {}, replace: (_path: string) => {}, back: () => {},
  openModal() {
    let id = '';
    id = modals.open({ title: 'Edit modal settings', content: <ModalEditor getId={() => id} />,
      onClose: () => { modalClosed++; } }); modalId = id;
  },
  closeModal() { modals.close(modalId); }, discardModals() { modals.discardAll(); }, modalClosed: () => modalClosed,
  replaceScope() { scope = 'b'; auth.activeTenant = { tenantId: 'b' }; for (const fn of listeners) fn(); },
  retire() { auth.authorizationState = { status: 'error' }; data.invalidate(); },
};
declare global { interface Window { __formSave: typeof harness } }
window.__formSave = harness;
configureFrontendObservability({ http: false, console: false });
function Fixture() {
  const router = useRouter(), pathname = usePathname();
  harness.push = (path, bypass = false) => router.push(path, { bypassGuards: bypass });
  harness.replace = path => router.replace(path); harness.back = () => router.back();
  const form = useForm({ schema, defaultValues: { title: 'Original', bio: 'Saved biography' }, baseline: 'accepted', initialRevision: 1,
    onSubmit: (values, context) => new Promise<FormSubmissionAcceptance>((resolve, reject) => {
      calls.push({ values, signal: context.signal, expectedRevision: context.expectedRevision, resolve, reject });
    }) });
  const controller = useFormSave({ form });
  harness.editDuringSave = value => form.setValue('bio', value);
  const title = form.register('title'), bio = form.register('bio');
  return <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-8">
    <h1 className="text-lg font-semibold">Profile settings</h1>
    <form onSubmit={form.handleSubmit} className="space-y-4">
      <label className="block space-y-2 text-sm">Display name<Input aria-label="Display name" value={String(title.value)} onChange={title.onChange} /></label>
      <label className="block space-y-2 text-sm">Biography<Input aria-label="Biography" value={String(bio.value)} onChange={bio.onChange} /></label>
    <p data-slot="form-state">{form.isDirty ? 'Dirty' : 'Clean'} · revision {form.revision}</p>
      <p data-slot="router-path">{pathname}</p>
    </form>
    <Button onClick={() => { void controller.requestLeave(() => { continued++; }); }}>Leave settings</Button>
    <div data-slot="last-setting" className="rounded-md border border-border p-4 text-sm">Your last setting remains reachable.</div>
    <FormSaveBar controller={controller} /><UnsavedChangesDialog controller={controller} />
  </main>;
}
function ModalEditor({ getId }: { getId: () => string }) {
  const form = useForm({ schema, defaultValues: { title: 'Modal original', bio: 'Modal biography' }, baseline: 'accepted', initialRevision: 1,
    onSubmit: (values, context) => new Promise<FormSubmissionAcceptance>((resolve, reject) => {
      calls.push({ values, signal: context.signal, expectedRevision: context.expectedRevision, resolve, reject });
    }) });
  const controller = useFormSave({ form });
  React.useEffect(() => {
    const id = getId(), beforeClose = () => controller.requestLeave(() => {});
    modals.update(id, { beforeClose });
    return () => {
      if (modalStore.getSnapshot().context.modals.find(modal => modal.id === id)?.beforeClose === beforeClose) {
        modals.update(id, { beforeClose: undefined });
      }
    };
  }, [getId, controller.requestLeave]);
  const title = form.register('title');
  return <div className="space-y-4 pt-6"><h2 className="text-sm font-semibold">Edit your display name</h2>
    <Input aria-label="Modal display name" value={String(title.value)} onChange={title.onChange} />
    <FormSaveBar controller={controller} placement="inline" /><UnsavedChangesDialog controller={controller} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ClientProvider client={client}><RouterProvider><ModalManager><Fixture /></ModalManager></RouterProvider></ClientProvider></React.StrictMode>);
