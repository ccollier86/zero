/** Synthetic current-capability checks; no account service or credential/provider calls. */
import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthConfigState } from '../../frontend/client/auth-hooks';
import type { AuthPublicConfig } from '../../frontend/client/auth-client';
import { MFAManagementPanel } from './mfa-management-panel';
import { resolveMfaManagementCapability } from './mfa-management-policy';

const mfa: NonNullable<AuthPublicConfig['mfa']> = {
  enabled: true, policy: 'optional', methods: ['email', 'totp'], availableMethods: ['email'],
  allowUserChoice: true, allowMultipleMethods: false, rememberDevice: false, recoveryCodes: false, ready: true,
};
function state(options: Partial<AuthConfigState> = {}): AuthConfigState {
  return { status: 'ready', config: { registration: { mode: 'disabled', bootstrapRequired: false, publicRegistrationEnabled: false }, mfa },
    isLoading: false, error: null, canRegister: false, bootstrapRequired: false, reload: async () => {}, ...options };
}

test('only a current ready explicit disabled policy hides the capability', () => {
  expect(resolveMfaManagementCapability(state({ config: { ...state().config!, mfa: { ...mfa, enabled: false } } })).kind).toBe('disabled');
  expect(resolveMfaManagementCapability(state({ status: 'unknown', config: null })).kind).toBe('loading');
  expect(resolveMfaManagementCapability(state({ status: 'loading', isLoading: true })).kind).toBe('loading');
  expect(resolveMfaManagementCapability(state({ status: 'loading', isLoading: true, config: { ...state().config!, mfa: { ...mfa, enabled: false } } })).kind).toBe('loading');
  expect(resolveMfaManagementCapability(state({ status: 'error', config: null, error: 'Synthetic config failure' })).kind).toBe('unavailable');
  expect(resolveMfaManagementCapability(state({ config: { registration: state().config!.registration } })).kind).toBe('unavailable');
});

test('enrollment uses actual configured and available methods with no fallback', () => {
  const available = resolveMfaManagementCapability(state());
  expect(available).toMatchObject({ kind: 'enabled', methods: ['email'], canEnroll: true });
  for (const config of [
    { ...mfa, availableMethods: [], ready: false }, { ...mfa, availableMethods: [], ready: true },
    { ...mfa, availableMethods: ['email'] as const, ready: false },
    { ...mfa, methods: ['totp'] as const, availableMethods: ['email'] as const },
  ]) {
    const capability = resolveMfaManagementCapability(state({ config: { ...state().config!, mfa: { ...config, methods: [...config.methods], availableMethods: [...config.availableMethods] } } }));
    expect(capability).toMatchObject({ kind: 'enabled', canEnroll: false });
  }
});

test('scope fingerprints retire enrollment for readiness, method and policy changes', () => {
  const original = resolveMfaManagementCapability(state());
  if (original.kind !== 'enabled') throw new Error('Expected enabled synthetic policy.');
  const equal = resolveMfaManagementCapability(state({ config: { ...state().config!, mfa: { ...mfa } } }));
  expect(equal.kind === 'enabled' && equal.key).toBe(original.key);
  for (const update of [{ ready: false }, { availableMethods: ['totp'] as ('email' | 'totp')[] }, { policy: 'required' as const }, { allowUserChoice: false }, { allowMultipleMethods: true }]) {
    const changed = resolveMfaManagementCapability(state({ config: { ...state().config!, mfa: { ...mfa, ...update } } }));
    expect(changed.kind === 'enabled' && changed.key).not.toBe(original.key);
  }
});

test('unknown SSR renders a deterministic explicit policy-loading state, not invented methods', () => {
  const html = renderToStaticMarkup(createElement(MFAManagementPanel));
  expect(html).toContain('Loading MFA policy…');
  expect(html).toContain('role="status"');
  expect(html).not.toContain('Set up two-factor');
  expect(html).not.toContain('Authenticator app');
});
