/** Isolated MFA policy/method receipts. Uses actual public hooks; no server or app credentials. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../../frontend/client/client-context';
import type { Client } from '../../frontend/client/sdk';
import type { AuthMfaMethod, AuthMfaSetupStartResult, AuthPublicConfig, AuthUser } from '../../frontend/client/auth-types';
import { getAuthConfigController } from '../../frontend/client/auth-config-controller';
import { configureFrontendObservability } from '../../frontend/client/observability';
import { MFAManagementPanel } from './mfa-management-panel';

interface Receipt<T> { resolve(value: T): void; reject(error: Error): void }
function deferred<T>(receipts: Receipt<T>[]): Promise<T> {
  return new Promise((resolve, reject) => receipts.push({ resolve, reject }));
}
const configs: Receipt<AuthPublicConfig>[] = [];
const lists: Receipt<{ methods: AuthMfaMethod[]; required: boolean }>[] = [];
const setups: Receipt<AuthMfaSetupStartResult>[] = [];
const calls: Array<{ action: 'config' | 'list' | 'start'; scope: string; method?: string }> = [];
const observations: string[] = [];
const listeners = new Set<() => void>();
function user(id: string): AuthUser {
  return { userId: id, username: id, email: `${id}@example.test`, firstName: null, lastName: null,
    role: 'member', status: 'active', passwordChangeRequired: false, emailVerifiedAt: 1,
    emailVerificationRequired: false, mfaRequired: false, properties: {}, createdAt: 1, updatedAt: null };
}
let scope = 'scope-a';
let context = {
  user: user('user-a') as AuthUser | null,
  activeTenant: { tenantId: 'tenant-a', kind: 'organization' as const, slug: 'a', name: 'A', role: 'member' },
  accessToken: 'synthetic-not-a-credential', refreshToken: null, isLoading: false, isRestoring: false,
  error: null, authenticationContinuation: null,
  sessionTransition: { phase: 'idle' as const, operation: null, revision: 0, recoverable: false, error: null },
};
const auth = {
  get user() { return context.user; },
  get activeTenant() { return context.activeTenant; },
  get isLoading() { return context.isLoading; },
  get isRestoring() { return context.isRestoring; },
  get isAuthenticated() { return context.user !== null; },
  get authorizationScopeKey() { return scope; },
  get sessionTransition() { return context.sessionTransition; },
  authorizationState: { status: 'ready' },
  store: { getSnapshot: () => ({ context }) },
  subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  subscribeAuthorization(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  getConfig() { calls.push({ action: 'config', scope }); return deferred(configs); },
  listMfaMethods() { calls.push({ action: 'list', scope }); return deferred(lists); },
  startMfaSetup(params: { method: 'email' | 'totp' }) {
    calls.push({ action: 'start', scope, method: params.method }); return deferred(setups);
  },
};
const configController = getAuthConfigController(auth);
function config(overrides: Partial<NonNullable<AuthPublicConfig['mfa']>> = {}): AuthPublicConfig {
  return {
    registration: { mode: 'disabled', bootstrapRequired: false, publicRegistrationEnabled: false },
    mfa: { enabled: true, policy: 'optional', methods: ['totp', 'email'], availableMethods: ['totp', 'email'],
      allowUserChoice: true, allowMultipleMethods: false, rememberDevice: false, recoveryCodes: false, ready: true, ...overrides },
  };
}
function method(type: 'email' | 'totp', status: AuthMfaMethod['status'] = 'active'): AuthMfaMethod {
  return { methodId: `synthetic-${type}`, type, label: null, status, isPrimary: true,
    createdAt: 1, verifiedAt: status === 'active' ? 1 : null, lastUsedAt: null };
}
const harness = {
  calls, observations,
  counts: () => ({ config: configs.length, list: lists.length, start: setups.length }),
  resolveConfig(index: number, overrides: Partial<NonNullable<AuthPublicConfig['mfa']>> = {}) { configs[index]!.resolve(config(overrides)); },
  resolveMissingMfa(index: number) { const value = config(); delete value.mfa; configs[index]!.resolve(value); },
  rejectConfig(index: number) { configs[index]!.reject(new Error('Synthetic private policy failure')); },
  resolveList(index: number, types: Array<'email' | 'totp'> = [], required = false) {
    lists[index]!.resolve({ methods: types.map(type => method(type)), required });
  },
  rejectList(index: number) { lists[index]!.reject(new Error('Synthetic method load failure')); },
  resolveSetup(index: number, type: 'email' | 'totp') {
    setups[index]!.resolve({ setupRequired: true, method: method(type, 'pending'), verificationToken: 'synthetic-verification',
      ...(type === 'email' ? { challenge: { challengeId: 'synthetic-challenge', methodType: type, expiresAt: 1, delivery: 'email' } }
        : { totp: { secret: 'SYNTHETICSETUPKEY', otpauthUrl: 'otpauth://totp/Test?secret=SYNTHETICSETUPKEY', issuer: 'Test', accountName: 'Test' } }) });
  },
  refreshPolicy() { void configController.refresh(); },
  invalidatePolicy() { configController.invalidate(); },
  switchScope() {
    scope = 'scope-b'; context = { ...context, user: user('user-b'), activeTenant: { ...context.activeTenant, tenantId: 'tenant-b', slug: 'b', name: 'B' } };
    for (const listener of listeners) listener();
  },
  signOut() {
    scope = 'signed-out'; context = { ...context, user: null };
    auth.authorizationState = { status: 'unauthenticated' };
    for (const listener of listeners) listener();
  },
};
declare global { interface Window { __mfaManagement: typeof harness } }
window.__mfaManagement = harness;
configureFrontendObservability({ sink: { emit: event => { observations.push(event.code); } } });
createRoot(document.getElementById('root')!).render(
  <ClientProvider client={{ auth } as unknown as Client}>
    <main className="mx-auto max-w-xl p-6" aria-label="Account security fixture"><MFAManagementPanel /></main>
  </ClientProvider>,
);
