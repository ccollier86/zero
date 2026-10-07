/** Synthetic controlled settings receipts with the real Zero provider boundary; no delivery/persistence. */

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsMatrix } from './settings-matrix';
import type { SettingsMatrixChange, SettingsMatrixValue } from './settings-matrix-types';
import { ClientProvider } from '../../frontend/client/client-context';
import { AuthorizationDataBoundaryController } from '../../frontend/client/authorization-data-boundary';
import type { Client } from '../../frontend/client/sdk';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../../frontend/client/observability';
import { Button } from '../ui/button';
import { Bell } from '../animate-ui/icons/bell';
import { MessageSquare } from '../animate-ui/icons/message-square';
import { Send } from '../animate-ui/icons/send';

const listeners = new Set<() => void>();
const dataBoundary = new AuthorizationDataBoundaryController();
let scope = 'organization-a';
const auth = {
  user: { userId: 'synthetic-user' }, activeTenant: { tenantId: 'organization-a' },
  isAuthenticated: true, isLoading: false, isRestoring: false,
  get authorizationScopeKey() { return scope; },
  sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
  authorizationState: { status: 'ready' },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  subscribeAuthorization(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
interface Receipt {
  readonly change: SettingsMatrixChange;
  readonly signal: AbortSignal;
  readonly scope: string;
  resolve(): void;
  reject(cause: unknown): void;
}
const calls: Receipt[] = [];
const events: FrontendObservabilityEvent[] = [];
const harness = {
  calls, events, setReadOnly: (_value: boolean) => {}, rerender: () => {},
  changeTarget: () => {}, changeOrganization: () => {}, setControl: (_control: 'checkbox' | 'switch') => {},
  changeOrganizationWithoutRender(next = 'organization-b') {
    scope = next; auth.activeTenant = { tenantId: next };
  },
  notifyBoundary() { for (const listener of listeners) listener(); },
  setUnavailable() { auth.authorizationState = { status: 'error' }; dataBoundary.invalidate(); },
  setReady() { auth.authorizationState = { status: 'ready' }; for (const listener of listeners) listener(); },
  resolve(index: number) { calls[index]!.resolve(); }, reject(index: number) { calls[index]!.reject(new Error('PRIVATE_MATRIX_PAYLOAD')); },
};
declare global { interface Window { __settingsMatrix: typeof harness } }
window.__settingsMatrix = harness;
configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
function initial(): SettingsMatrixValue {
  return { comments: { 'in-app': true, email: false, push: false },
    projects: { 'in-app': true, email: true, push: false },
    security: { 'in-app': true, email: true }, account: { 'in-app': true, email: false, push: false } };
}
function Fixture() {
  const [value, setValue] = useState(initial), [readOnly, setReadOnly] = useState(false);
  const [target, setTarget] = useState(0), [revision, setRevision] = useState(0);
  const [control, setControl] = useState<'checkbox' | 'switch'>('checkbox');
  harness.setReadOnly = setReadOnly; harness.setControl = setControl;
  harness.rerender = () => setRevision((revision) => revision + 1);
  harness.changeTarget = () => { setTarget((target) => target + 1); setValue(initial()); };
  harness.changeOrganization = () => {
    scope = 'organization-b'; auth.activeTenant = { tenantId: 'organization-b' };
    setValue(initial()); for (const listener of listeners) listener();
  };
  return <ClientProvider client={{ auth, _authorizationDataBoundary: dataBoundary } as unknown as Client}>
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8" data-revision={revision}>
      <SettingsMatrix title="Notifications" description="Choose where you receive updates about your work."
        scopeKey={target} control={control} readOnly={readOnly} value={value}
        columns={[{ id: 'in-app', label: 'In app', icon: <MessageSquare />, description: 'Updates inside your workspace.' },
          { id: 'email', label: 'Email', icon: <Send /> }, { id: 'push', label: 'Push', icon: <Bell /> }]}
        rows={[{ id: 'comments', label: 'Comments and mentions', description: 'Replies and discussions you are following.' },
          { id: 'projects', label: 'Project updates', description: 'Changes to projects and tasks you participate in.' },
          { id: 'security', label: 'Security alerts', description: 'Important notices about account access.',
            cells: { email: { disabled: true, disabledReason: 'Required security alerts cannot be changed.' } } },
          { id: 'account', label: 'Account updates', description: 'Your account administrator manages these preferences.', readOnly: true }]}
        help={<Button variant="link" size="xs" type="button">About these settings</Button>}
        onChange={(change, context) => new Promise<void>((resolve, reject) => {
          const admittedScope = scope, admittedTarget = target;
          calls.push({ change, signal: context.signal, scope: admittedScope,
            resolve() {
              if (!context.signal.aborted && scope === admittedScope && target === admittedTarget) {
                setValue((current) => ({ ...current, [change.rowId]: { ...current[change.rowId], [change.columnId]: change.checked } }));
              }
              resolve();
            }, reject });
        })} />
    </main>
  </ClientProvider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
