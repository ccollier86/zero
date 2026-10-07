/** Synthetic app-controlled receipts with the real provider boundary; no OAuth or external app calls. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../../frontend/client/client-context';
import { AuthorizationDataBoundaryController } from '../../frontend/client/authorization-data-boundary';
import type { Client } from '../../frontend/client/sdk';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../../frontend/client/observability';
import { Clock } from '../animate-ui/icons/clock';
import { MessageSquare } from '../animate-ui/icons/message-square';
import { Settings } from '../animate-ui/icons/settings';
import { RotateCw } from '../animate-ui/icons/rotate-cw';
import { Trash } from '../animate-ui/icons/trash';
import { IntegrationSettingsList, type IntegrationSettingsItem, type IntegrationSettingsActionContext } from './index';

const listeners = new Set<() => void>(), dataBoundary = new AuthorizationDataBoundaryController();
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
const client = { auth, _authorizationDataBoundary: dataBoundary } as unknown as Client;
interface Receipt {
  readonly action: string;
  readonly itemId: string | null;
  readonly groupId: string | null;
  readonly signal: AbortSignal;
  readonly scope: string;
  resolve(): void;
  reject(cause: unknown): void;
}
const calls: Receipt[] = [], events: FrontendObservabilityEvent[] = [], errors: string[] = [];
const harness = {
  calls, events, errors,
  setReadOnly: (_value: boolean) => {}, setRevision: (_value: number) => {},
  setFlat: (_value: boolean) => {},
  setCapability: (_value: boolean) => {}, setPrimaryDisabled: (_value: boolean) => {},
  removeItem: () => {}, changeTarget: () => {}, rerender: () => {},
  changeOrganization(notify = true) {
    scope = 'organization-b'; auth.activeTenant = { tenantId: scope };
    if (notify) for (const listener of listeners) listener();
  },
  setUnavailable() { auth.authorizationState = { status: 'error' }; dataBoundary.invalidate(); },
  setReady() { auth.authorizationState = { status: 'ready' }; for (const listener of listeners) listener(); },
  resolve(index: number) { calls[index]!.resolve(); },
  reject(index: number) { calls[index]!.reject(new Error('PRIVATE_INTEGRATION_FAILURE')); },
};
declare global { interface Window { __integrationSettings: typeof harness } }
window.__integrationSettings = harness;
configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
function record(action: string, context: Pick<IntegrationSettingsActionContext, 'signal'> & Partial<IntegrationSettingsActionContext>) {
  return new Promise<void>((resolve, reject) => calls.push({ action, itemId: context.item?.id ?? null,
    groupId: context.groupId ?? null, signal: context.signal, scope, resolve, reject }));
}

function Fixture() {
  const [readOnly, setReadOnly] = useState(false), [revision, setRevision] = useState(0);
  const [capability, setCapability] = useState(true), [primaryDisabled, setPrimaryDisabled] = useState(false);
  const [removed, setRemoved] = useState(false), [target, setTarget] = useState(0), [render, setRender] = useState(0);
  const [flat, setFlat] = useState(false);
  const longCopy = new URLSearchParams(location.search).has('long');
  const groupId = new URLSearchParams(location.search).has('collision') ? 'flat' : 'communication';
  harness.setReadOnly = setReadOnly; harness.setRevision = setRevision; harness.setCapability = setCapability;
  harness.setPrimaryDisabled = setPrimaryDisabled; harness.removeItem = () => setRemoved(true);
  harness.setFlat = setFlat;
  harness.changeTarget = () => setTarget(current => current + 1);
  harness.rerender = () => setRender(current => current + 1);
  const slack: IntegrationSettingsItem = {
    id: 'slack', revision, title: 'Slack', description: 'Workplace messaging', icon: <MessageSquare />,
    status: { label: longCopy ? 'A very long configured connection status with important details' : 'Connected', tone: 'success' },
    actions: [
      { id: 'review', label: 'Review setup', icon: <Settings />, onSelect: context => record('review', context) },
      { id: 'reconnect', label: 'Reconnect', icon: <RotateCw />, disabled: !capability,
        disabledReason: capability ? undefined : 'Your administrator manages this connection', onSelect: context => record('reconnect', context) },
      { id: 'locked', label: 'Managed setting', disabledReason: 'Managed by your organization', onSelect: context => record('locked', context) },
      { id: 'remove', label: 'Remove connection', icon: <Trash />, destructive: true,
        disabled: !capability, onSelect: context => record('remove', context) },
    ],
  };
  const data = flat ? { items: removed ? [] : [slack] } : { groups: [
    { id: groupId, title: 'Communication', description: 'Messaging and meeting tools', items: [
      ...(removed ? [] : [slack]),
      { id: 'zoom', title: 'Zoom', description: 'Video meetings and webinars', icon: <MessageSquare />,
        status: { label: 'Needs review', tone: 'warning' as const } },
    ] },
    { id: 'scheduling', title: 'Scheduling', description: 'Calendar and time management', items: [
      { id: 'calendar', title: 'Google Calendar', description: 'Scheduling and event planning', icon: <Clock />,
        status: { label: 'Connected', tone: 'success' as const } },
    ] },
  ] };
  return <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8" data-testid="fixture-ready" data-render={render}>
    <ClientProvider client={client}>
      <IntegrationSettingsList data-testid="grouped-list" title="App Connections"
        description="Manage third-party services for workflow automation." contextMenu readOnly={readOnly}
        operationScopeKey={target} primaryAction={{ label: longCopy ? 'Connect another organization integration account' : undefined,
          disabled: primaryDisabled, onSelect: context => record('new', context) }}
        onActionError={cause => { errors.push(String(cause)); }}
        {...data} />
    </ClientProvider>
    <IntegrationSettingsList data-testid="flat-list" aria-label="Personal integrations" items={[
      { id: 'personal', title: 'A long personal connection name that remains readable on compact screens',
        description: 'personal-connection-label-with-no-whitespace-to-test-narrow-layout', status: { label: 'Not connected', tone: 'muted' } },
    ]} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
