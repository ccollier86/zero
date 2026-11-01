/** Actual native form/hooks with controllable acknowledged SDK receipts; no real accounts or data. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ClientProvider } from '../../frontend/client/client-context';
import type { Client } from '../../frontend/client/sdk';
import type { AuthPublicConfig, AuthUser, AuthUserPropertyConfig } from '../../frontend/client/auth-types';
import { AuthClientError } from '../../frontend/client/auth-errors';
import { getAuthConfigController } from '../../frontend/client/auth-config-controller';
import { AuthorizationDataBoundaryController } from '../../frontend/client/authorization-data-boundary';
import { configureFrontendObservability } from '../../frontend/client/observability';
import { UserPropertiesForm } from './user-properties-form';

const listeners = new Set<() => void>(), calls: { userId: string; key: string; value: unknown; resolve(): void; reject(cause: unknown): void }[] = [];
const observations: string[] = [];
let scope = 'account-a', reads = 0, successes = 0, callbackThrows = false;
let configUnavailable = false;
let server: Record<string, string> = {};
let fields: Record<string, AuthUserPropertyConfig> = {
  professional_credentials: { key: 'professional_credentials', label: 'Professional credentials', type: 'string', editableBy: 'user' },
  professional_region: { key: 'professional_region', label: 'Professional region', type: 'string', editableBy: 'user' },
  optional: { key: 'optional', label: 'Optional setting', type: 'string', editableBy: 'user' },
  restricted: { key: 'restricted', label: 'Restricted', type: 'string', editableBy: 'admin' },
};
const data = new AuthorizationDataBoundaryController();
let user: AuthUser = { userId: 'account-a', username: 'synthetic', email: 'synthetic@example.test',
  firstName: 'Synthetic', lastName: null, role: 'user', status: 'active', properties: {}, createdAt: 1, updatedAt: null,
  passwordChangeRequired: false, emailVerifiedAt: 1, emailVerificationRequired: false, mfaRequired: false };
const context = () => ({ user, activeTenant: null, accessToken: null, refreshToken: null, isLoading: false, isRestoring: false, error: null,
  authenticationContinuation: null, sessionTransition: { phase: 'idle' as const, operation: null, revision: 0, recoverable: false, error: null } });
let snapshot = context();
const notify = () => { snapshot = context(); for (const listener of listeners) listener(); };
const auth = {
  get user() { return user; }, get isAuthenticated() { return true; }, get isLoading() { return false; }, get isRestoring() { return false; },
  get sessionTransition() { return context().sessionTransition; }, get authorizationScopeKey() { return scope; },
  activeTenant: null, authorizationState: { status: 'ready', snapshot: null, error: null },
  store: { getSnapshot: () => ({ context: snapshot }) },
  subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  subscribeAuthorization(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  async getConfig(): Promise<AuthPublicConfig> {
    if (configUnavailable) throw new AuthClientError('Synthetic policy unavailable.', 503, 'AUTH_NOT_READY', null);
    return { userProperties: structuredClone(fields), registration: { mode: 'disabled', bootstrapRequired: false, publicRegistrationEnabled: false } };
  },
  setProperty(key: string, value: unknown) {
    return new Promise<void>((resolve, reject) => calls.push({ userId: user.userId, key, value, resolve, reject }));
  },
  async getProperties() { reads++; user = { ...user, properties: { ...server } }; notify(); return { ...server }; },
};
let client = { auth, _authorizationDataBoundary: data } as unknown as Client;
const harness = {
  calls, observations, snapshot: () => ({ successes, reads, properties: user.properties }),
  resolve(index: number) {
    const call = calls[index]!;
    if (call.userId === user.userId) { server = { ...server, [call.key]: String(call.value) }; user = { ...user, properties: { ...server } }; notify(); }
    call.resolve();
  },
  reject(index: number, unknown = false, committed = false) {
    const call = calls[index]!;
    if (committed && call.userId === user.userId) server = { ...server, [call.key]: String(call.value) };
    call.reject(new AuthClientError('Synthetic setting failure.', unknown ? 503 : 422, unknown ? 'LOGGING_OUTCOME_UNKNOWN' : 'INVALID_PROPERTY_VALUE', null));
  },
  async personalUpdate() { user = { ...user, firstName: 'Personal update', updatedAt: 2 }; notify(); await getAuthConfigController(auth).refresh(); },
  async restrict() { fields = { ...fields, professional_region: { ...fields.professional_region!, editableBy: 'admin' } }; await getAuthConfigController(auth).refresh(); },
  async failConfiguration() { configUnavailable = true; await getAuthConfigController(auth).refresh(); },
  recoverConfiguration() { configUnavailable = false; },
  replaceAccount() { scope = 'account-b'; server = {}; user = { ...user, userId: 'account-b', properties: {} }; notify(); },
  retire() { auth.authorizationState = { status: 'error', snapshot: null, error: null }; data.invalidate(); },
  replaceClient: () => {}, hide: () => {}, show: () => {}, allowUnchangedButton: () => {},
  failCallback() { callbackThrows = true; },
};
declare global { interface Window { __propertiesForm: typeof harness } }
window.__propertiesForm = harness;
configureFrontendObservability({ sink: { emit(event) { observations.push(event.code); } } });
function Fixture() {
  const [selectedClient, setClient] = React.useState(client), [visible, setVisible] = React.useState(true), [disable, setDisable] = React.useState(true);
  const [clientGeneration, setClientGeneration] = React.useState(0);
  harness.replaceClient = () => flushSync(() => { client = { auth, _authorizationDataBoundary: data } as unknown as Client; setClient(client); setClientGeneration(value => value + 1); });
  harness.hide = () => flushSync(() => setVisible(false)); harness.show = () => setVisible(true); harness.allowUnchangedButton = () => setDisable(false);
  return <ClientProvider key={clientGeneration} client={selectedClient}>{visible && <UserPropertiesForm title="Professional profile" disableSaveWhenUnchanged={disable}
    onSuccess={() => { successes++; if (callbackThrows) throw new Error('PRIVATE_CALLBACK_PAYLOAD'); }} />}</ClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
